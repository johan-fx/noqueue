import { HTTPException } from 'hono/http-exception'
import {
  decode as decodePng,
  encode as encodePng,
  type DecodedPng,
} from 'fast-png'
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'
import { createInflate } from 'node:zlib'

const MiB = 1024 * 1024
export const LOGO_MAX_PIXELS = 8_000_000
export const LOGO_MAX_SIDE = 16384
export const LOGO_OUTPUT_SIDE = 512
const invalid = () => new HTTPException(400, { message: 'invalid_logo' })
const memoryLimit = () =>
  new HTTPException(400, { message: 'logo_image_memory_limit' })
const unsupported = () =>
  new HTTPException(400, { message: 'logo_image_unsupported' })

function dimensions(width: number, height: number) {
  if (!width || !height) throw invalid()
  if (
    width > LOGO_MAX_SIDE ||
    height > LOGO_MAX_SIDE ||
    width * height > LOGO_MAX_PIXELS
  )
    throw new HTTPException(400, { message: 'logo_dimensions_exceeded' })
}

// Validate inflation without retaining another full decoded image. Destroy the
// stream as soon as the declared scanline budget is exceeded (zip-bomb defence).
async function checkInflation(
  parts: Uint8Array[],
  maximum: number,
  exact = false,
) {
  await new Promise<void>((resolve, reject) => {
    const stream = createInflate({ chunkSize: 16384 })
    let size = 0
    stream.on('data', (chunk: Uint8Array) => {
      size += chunk.byteLength
      if (size > maximum) stream.destroy(invalid())
    })
    stream.on('error', reject)
    stream.on('end', () => {
      if (exact && size !== maximum) reject(invalid())
      else resolve()
    })
    for (const part of parts) stream.write(part)
    stream.end()
  })
}

// EXIF orientation is applied before dropping metadata. Malformed optional
// metadata is ignored; it must never produce out-of-range image reads.
function orientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const order = view.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return 1
  const little = order === 0x4949
  if (view.getUint16(2, little) !== 42) return 1
  const offset = view.getUint32(4, little)
  if (offset > tiff.length - 2) return 1
  const count = view.getUint16(offset, little)
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12
    if (entry > tiff.length - 12) return 1
    if (view.getUint16(entry, little) !== 0x112) continue
    if (
      view.getUint16(entry + 2, little) !== 3 ||
      view.getUint32(entry + 4, little) !== 1
    )
      return 1
    const value = view.getUint16(entry + 8, little)
    return value >= 1 && value <= 8 ? value : 1
  }
  return 1
}

async function pngHeader(bytes: Uint8Array) {
  if (bytes.length < 45) throw invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kindAt = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (view.getUint32(8) !== 13 || kindAt(12) !== 'IHDR') throw invalid()
  const width = view.getUint32(16),
    height = view.getUint32(20)
  dimensions(width, height)
  const depth = view.getUint8(24),
    color = view.getUint8(25),
    interlace = view.getUint8(28)
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
    color
  ]
  const depths =
    color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16]
  if (
    !channels ||
    !depths.includes(depth) ||
    view.getUint8(26) !== 0 ||
    view.getUint8(27) !== 0 ||
    interlace > 1
  )
    throw invalid()
  // fast-png's Adam7 decoder handles byte-sized samples, not packed samples.
  if (interlace && depth < 8) throw unsupported()
  const samples = width * height * channels * (depth === 16 ? 2 : 1)
  // Decoder may temporarily retain scanline chunks + joined scanlines + pixels.
  // Reserve space for request copies, resized output and the rest of the Worker.
  if (
    samples > 32 * MiB ||
    samples * 3 + bytes.byteLength * 3 + 8 * MiB > 96 * MiB
  )
    throw memoryLimit()
  const idat: Uint8Array[] = []
  const metadata = new Set<string>()
  let chunks = 0
  let ended = false,
    exif = 1,
    hasIdat = false,
    idatEnded = false
  for (let offset = 8; offset < bytes.length; ) {
    if (++chunks > 4096)
      throw new HTTPException(400, { message: 'logo_image_complexity_limit' })
    if (offset + 12 > bytes.length) throw invalid()
    const length = view.getUint32(offset)
    if (offset + length + 12 > bytes.length) throw invalid()
    const kind = kindAt(offset + 4)
    if (['PLTE', 'tRNS', 'iCCP', 'eXIf'].includes(kind)) {
      if (metadata.has(kind) || hasIdat) throw invalid()
      metadata.add(kind)
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (['acTL', 'fcTL', 'fdAT'].includes(kind)) throw unsupported()
    if (['zTXt', 'iTXt'].includes(kind)) throw unsupported()
    if (kind === 'iCCP') {
      const zero = data.indexOf(0)
      if (zero < 1 || zero > 79 || data[zero + 1] !== 0) throw invalid()
      await checkInflation([data.subarray(zero + 2)], MiB)
    }
    if (kind === 'eXIf') exif = orientation(data)
    if (offset !== 8 && kind === 'IHDR') throw invalid()
    if (kind === 'IDAT') {
      if (idatEnded) throw invalid()
      hasIdat = true
      idat.push(data)
    } else if (hasIdat) idatEnded = true
    offset += length + 12
    if (kind === 'IEND') {
      if (length || offset !== bytes.length) throw invalid()
      ended = true
    }
  }
  if (!ended || !idat.length) throw invalid()
  // Exact expected inflation, including Adam7 pass padding and filter bytes.
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]]
  let scanlineBytes = 0
  for (const [x = 0, y = 0, dx = 1, dy = 1] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy))
    if (w && h) scanlineBytes += (Math.ceil((w * channels * depth) / 8) + 1) * h
  }
  await checkInflation(idat, scanlineBytes, true)
  return exif
}

function jpegHeader(bytes: Uint8Array) {
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let exif = 1,
    foundSize = false
  for (let offset = 2; offset < bytes.length; ) {
    if (bytes[offset++] !== 0xff) throw invalid()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    if (
      marker === 0x01 ||
      (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
    )
      continue
    if (offset + 2 > bytes.length) throw invalid()
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) throw invalid()
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) throw invalid()
      dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3))
      foundSize = true
    }
    if (
      marker === 0xe1 &&
      length >= 8 &&
      String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) ===
        'Exif\0\0'
    )
      exif = orientation(bytes.subarray(offset + 8, offset + length))
    offset += length
  }
  if (!foundSize) throw invalid()
  return exif
}

type Raster = Pick<
  DecodedPng,
  | 'data'
  | 'width'
  | 'height'
  | 'channels'
  | 'depth'
  | 'palette'
  | 'transparency'
>

// Area resampling in premultiplied alpha: no black/coloured halo around a
// transparent logo. Read original samples directly, without a full RGBA copy.
function resize(image: Raster, exif: number) {
  const { width, height, channels, depth, data, palette, transparency } = image
  const scale = Math.min(1, LOGO_OUTPUT_SIDE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale))
  const rotated = exif >= 5
  const outWidth = rotated ? h : w,
    outHeight = rotated ? w : h
  const out = new Uint8Array(outWidth * outHeight * 4)
  const sampleMax = (1 << depth) - 1
  const rowBytes = Math.ceil((width * channels * depth) / 8)
  const sample = (x: number, y: number, c: number): number => {
    if (depth >= 8) return data[(y * width + x) * channels + c]!
    const bit = (x * channels + c) * depth
    return (
      (data[y * rowBytes + (bit >> 3)]! >> (8 - depth - (bit & 7))) & sampleMax
    )
  }
  for (let oy = 0; oy < h; oy++)
    for (let ox = 0; ox < w; ox++) {
      const x0 = (ox * width) / w,
        x1 = ((ox + 1) * width) / w
      const y0 = (oy * height) / h,
        y1 = ((oy + 1) * height) / h
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const weight =
            (Math.min(x + 1, x1) - Math.max(x, x0)) *
            (Math.min(y + 1, y1) - Math.max(y, y0))
          const c0 = sample(x, y, 0)
          let r: number,
            g: number,
            b: number,
            a = 255
          if (palette) {
            const color = palette[c0]
            if (!color || color.length < 3) throw invalid()
            r = color[0]!
            g = color[1]!
            b = color[2]!
            a = color[3] ?? 255
          } else if (channels <= 2) {
            r = g = b = (c0 * 255) / sampleMax
            if (channels === 2) a = (sample(x, y, 1) * 255) / sampleMax
            else if (transparency?.[0] === c0) a = 0
          } else {
            const c1 = sample(x, y, 1),
              c2 = sample(x, y, 2)
            r = (c0 * 255) / sampleMax
            g = (c1 * 255) / sampleMax
            b = (c2 * 255) / sampleMax
            if (channels === 4) a = (sample(x, y, 3) * 255) / sampleMax
            else if (
              transparency &&
              transparency[0] === c0 &&
              transparency[1] === c1 &&
              transparency[2] === c2
            )
              a = 0
          }
          alpha += a * weight
          red += r * a * weight
          green += g * a * weight
          blue += b * a * weight
        }
      let x = ox,
        y = oy
      if (exif === 2) x = w - 1 - ox
      else if (exif === 3) {
        x = w - 1 - ox
        y = h - 1 - oy
      } else if (exif === 4) y = h - 1 - oy
      else if (exif === 5) {
        x = oy
        y = ox
      } else if (exif === 6) {
        x = h - 1 - oy
        y = ox
      } else if (exif === 7) {
        x = h - 1 - oy
        y = w - 1 - ox
      } else if (exif === 8) {
        x = oy
        y = w - 1 - ox
      }
      const dest = (y * outWidth + x) * 4
      if (alpha) {
        out[dest] = Math.round(red / alpha)
        out[dest + 1] = Math.round(green / alpha)
        out[dest + 2] = Math.round(blue / alpha)
      }
      out[dest + 3] = Math.round(alpha / ((x1 - x0) * (y1 - y0)))
    }
  return { width: outWidth, height: outHeight, data: out }
}

// One heavy raster decode per isolate. Fail retryably rather than queueing
// large image buffers and exceeding the Worker's shared memory budget.
let processing = false
export async function normalizeRaster(
  bytes: Uint8Array,
  type: 'image/png' | 'image/jpeg',
) {
  if (processing)
    throw new HTTPException(503, { message: 'logo_processing_busy' })
  processing = true
  try {
    if (type === 'image/png') {
      const exif = await pngHeader(bytes)
      const image = decodePng(bytes, { checkCrc: true })
      return encodePng({ ...resize(image, exif), channels: 4, depth: 8 })
    }
    const exif = jpegHeader(bytes)
    let decoded: { width: number; height: number; data: Uint8Array }
    try {
      decoded = decodeJpeg(bytes, {
        useTArray: true,
        tolerantDecoding: false,
        maxResolutionInMP: 8,
        maxMemoryUsageInMB: 48,
      })
    } catch (error) {
      if (error instanceof Error && /maxMemoryUsageInMB/.test(error.message))
        throw memoryLimit()
      throw error
    }
    return new Uint8Array(
      encodeJpeg(resize({ ...decoded, depth: 8, channels: 4 }, exif), 90).data,
    )
  } finally {
    processing = false
  }
}
