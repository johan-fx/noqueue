import { describe, expect, it } from 'vitest'
import { decode, encode } from 'fast-png'
import { encode as jpeg } from 'jpeg-js'
import { deflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { normalizeLogo } from './features/staff/logo-image'

function chunk(type: string, data: Uint8Array) {
  const bytes = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, bytes, checksum])
}
function png(
  width: number,
  height: number,
  raw: Uint8Array,
  depth = 8,
  color = 6,
  extra: Buffer[] = [],
) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = depth
  header[9] = color
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
async function normalize(bytes: Uint8Array, type = 'image/png') {
  return normalizeLogo(
    new File([bytes], type === 'image/png' ? 'logo.png' : 'logo.jpg', { type }),
    bytes,
  )
}
// Equivalent dimensions/depth to the reported FIPAV image, with synthetic pixels.
// Never copy a user's Downloads file into the test suite.
function largePng() {
  const w = 2813,
    h = 2292
  const raw = new Uint8Array(h * (w * 4 + 1))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const offset = y * (w * 4 + 1) + 1 + x * 4
      raw[offset] = 255
      raw[offset + 3] = x < w / 2 ? 255 : 0
    }
  return png(w, h, raw)
}

describe('safe raster logo normalization', () => {
  it('bounds PNG chunk count and rejects repeated compressed metadata', async () => {
    const extras = Array.from({ length: 4096 }, () =>
      chunk('tEXt', Buffer.from('k\0v')),
    )
    await expect(
      normalize(png(1, 1, new Uint8Array(5), 8, 6, extras)),
    ).rejects.toMatchObject({ message: 'logo_image_complexity_limit' })
    const profile = chunk(
      'iCCP',
      Buffer.concat([Buffer.from('sRGB\0\0'), deflateSync(new Uint8Array(1))]),
    )
    await expect(
      normalize(png(1, 1, new Uint8Array(5), 8, 6, [profile, profile])),
    ).rejects.toMatchObject({ message: 'invalid_logo' })
  })
  it('accepts the reported 2813×2292 PNG resolution and stores a transparent 512×417 PNG', async () => {
    const result = await normalize(largePng())
    const image = decode(result.bytes, { checkCrc: true })
    expect([image.width, image.height]).toEqual([512, 417])
    expect(result.type).toBe('image/png')
    expect(result.bytes.length).toBeLessThan(100_000)
    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(image.data[(image.width - 1) * 4 + 3]).toBe(0)
  })

  it('downsamples premultiplied alpha without dark fringes and does not crop', async () => {
    const data = new Uint8Array(1024 * 4)
    for (let x = 0; x < 1024; x++) {
      data[x * 4] = x % 2 === 0 ? 255 : 0
      data[x * 4 + 3] = x % 2 === 0 ? 255 : 0
    }
    const image = decode(
      (await normalize(encode({ width: 1024, height: 1, channels: 4, data })))
        .bytes,
    )
    expect([image.width, image.height]).toEqual([512, 1])
    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 0, 128])
  })

  it('does not enlarge small logos and removes text metadata', async () => {
    const data = new Uint8Array([255, 0, 0, 255])
    const image = decode(
      (
        await normalize(
          encode({
            width: 1,
            height: 1,
            channels: 4,
            data,
            text: { Comment: 'private' },
          }),
        )
      ).bytes,
    )
    expect([image.width, image.height]).toEqual([1, 1])
    expect(image.text).toEqual({})
  })

  it('preserves packed palette alpha and grayscale transparency', async () => {
    const palette = png(2, 1, new Uint8Array([0, 0b01000000]), 1, 3, [
      chunk('PLTE', new Uint8Array([255, 0, 0, 0, 0, 255])),
      chunk('tRNS', new Uint8Array([255, 0])),
    ])
    expect(Array.from(decode((await normalize(palette)).bytes).data)).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0,
    ])
    const gray = png(2, 1, new Uint8Array([0, 0b01000000]), 1, 0, [
      chunk('tRNS', new Uint8Array([0, 0])),
    ])
    expect(Array.from(decode((await normalize(gray)).bytes).data)).toEqual([
      0, 0, 0, 0, 255, 255, 255, 255,
    ])
  })

  it('converts 16-bit samples to 8-bit and handles Adam7 byte-sized images', async () => {
    const hi = encode({
      width: 1,
      height: 1,
      channels: 4,
      depth: 16,
      data: new Uint16Array([65535, 0, 0, 32768]),
    })
    expect(Array.from(decode((await normalize(hi)).bytes).data)).toEqual([
      255, 0, 0, 128,
    ])
    const interlaced = encode(
      { width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(255) },
      { interlace: 'Adam7' },
    )
    expect(
      Array.from(decode((await normalize(interlaced)).bytes).data),
    ).toEqual(new Array(16).fill(255))
  })

  it('rejects resolution and memory excess with distinct actionable codes before decoding', async () => {
    await expect(
      normalize(png(4000, 3000, new Uint8Array())),
    ).rejects.toMatchObject({ message: 'logo_dimensions_exceeded' })
    await expect(
      normalize(png(16385, 1, new Uint8Array())),
    ).rejects.toMatchObject({ message: 'logo_dimensions_exceeded' })
    await expect(
      normalize(png(2813, 2292, new Uint8Array(), 16)),
    ).rejects.toMatchObject({ message: 'logo_image_memory_limit' })
  })

  it('rejects inflated data beyond declared scanlines, truncation and corrupt CRCs', async () => {
    await expect(
      normalize(png(1, 1, new Uint8Array(1024 * 1024))),
    ).rejects.toMatchObject({ message: 'invalid_logo' })
    await expect(normalize(png(1, 1, new Uint8Array(4)))).rejects.toMatchObject(
      { message: 'invalid_logo' },
    )
    const bad = png(1, 1, new Uint8Array(5))
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1
    await expect(normalize(bad)).rejects.toMatchObject({
      message: 'invalid_logo',
    })
  })

  it('reports unsupported animation explicitly and releases its processing guard on errors', async () => {
    await expect(
      normalize(
        png(1, 1, new Uint8Array(5), 8, 6, [chunk('acTL', new Uint8Array(8))]),
      ),
    ).rejects.toMatchObject({ message: 'logo_image_unsupported' })
    expect((await normalize(png(1, 1, new Uint8Array(5)))).type).toBe(
      'image/png',
    )
  })

  it('bounds concurrent decoder memory and makes a rejected request retryable', async () => {
    const input = png(1, 1, new Uint8Array(5))
    const first = normalize(input)
    await expect(normalize(input)).rejects.toMatchObject({
      status: 503,
      message: 'logo_processing_busy',
    })
    await first
    await expect(normalize(input)).resolves.toMatchObject({ type: 'image/png' })
  })

  it('normalizes JPEG dimensions and applies EXIF orientation before stripping metadata', async () => {
    const source = jpeg(
      {
        width: 1024,
        height: 512,
        data: new Uint8Array(1024 * 512 * 4).fill(255),
      },
      90,
    ).data
    // Big-endian TIFF orientation=6, one SHORT entry.
    const tiff = Buffer.from(
      '4d4d002a00000008000101120003000000010006000000000000',
      'hex',
    )
    const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
    const marker = Buffer.alloc(4)
    marker[0] = 255
    marker[1] = 225
    marker.writeUInt16BE(exif.length + 2, 2)
    const input = Buffer.concat([
      source.subarray(0, 2),
      marker,
      exif,
      source.subarray(2),
    ])
    const result = await normalize(input, 'image/jpeg')
    expect(result.type).toBe('image/jpeg')
    const { decode: decodeJpeg } = await import('jpeg-js')
    const image = decodeJpeg(result.bytes)
    expect([image.width, image.height]).toEqual([256, 512])
    expect(Buffer.from(result.bytes).includes(Buffer.from('Exif\0\0'))).toBe(
      false,
    )
  })
})
