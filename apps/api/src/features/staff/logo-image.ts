import { HTTPException } from 'hono/http-exception'
import { VENUE_LOGO_MAX_BYTES } from '@noqueue/contracts/staff'
import { hasPngSignature } from 'fast-png'
import { normalizeRaster } from './logo-raster'
import { SaxesParser } from 'saxes'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import wasm from '@resvg/resvg-wasm/index_bg.wasm'

let initialization: Promise<void> | undefined
const invalid = () => new HTTPException(400, { message: 'invalid_logo' })
const maxPixels = 4 * 1024 * 1024
const dimensions = (width: number, height: number) => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 16384 ||
    height > 16384 ||
    width * height > maxPixels
  )
    throw invalid()
}

function validateSvg(source: string) {
  const parser = new SaxesParser({ xmlns: true })
  let count = 0,
    depth = 0
  parser.on('error', () => {
    throw invalid()
  })
  parser.on('doctype', () => {
    throw invalid()
  })
  parser.on('processinginstruction', () => {
    throw invalid()
  })
  parser.on('opentag', (tag) => {
    if (
      ++count > 10000 ||
      ++depth > 64 ||
      tag.uri !== 'http://www.w3.org/2000/svg'
    )
      throw invalid()
    if (count === 1 && tag.local !== 'svg') throw invalid()
    // Standalone vector artwork only. Reject instead of silently losing content.
    if (
      [
        'script',
        'foreignObject',
        'image',
        'filter',
        'feImage',
        'animate',
        'animateTransform',
        'set',
      ].includes(tag.local)
    )
      throw invalid()
    if (['text', 'tspan', 'textPath'].includes(tag.local))
      throw new HTTPException(400, { message: 'logo_svg_text_requires_paths' })
    for (const attribute of Object.values(tag.attributes)) {
      if (/^on/i.test(attribute.local) || attribute.value.length > 256000)
        throw invalid()
      if (
        attribute.local === 'href' &&
        !/^#[A-Za-z_][\w:.-]*$/.test(attribute.value)
      )
        throw invalid()
    }
  })
  parser.on('closetag', () => {
    depth--
  })
  parser.write(source).close()
  if (!count) throw invalid()
}

export async function normalizeLogo(
  file: File,
  bytes: Uint8Array,
): Promise<{
  bytes: Uint8Array
  type: 'image/png' | 'image/jpeg'
  name: string
}> {
  if (bytes.byteLength > VENUE_LOGO_MAX_BYTES)
    throw new HTTPException(413, { message: 'logo_too_large' })
  if (!bytes.byteLength) throw invalid()
  const ext = file.name.split('.').at(-1)?.toLowerCase()
  const mime = file.type.toLowerCase()
  const name =
    file.name
      .replace(/[\x00-\x1f\x7f/\\]/g, '_')
      .trim()
      .slice(0, 176) || 'logotipo'
  try {
    if (hasPngSignature(bytes)) {
      if (ext !== 'png' || (mime && mime !== 'image/png')) throw invalid()
      return {
        bytes: await normalizeRaster(bytes, 'image/png'),
        type: 'image/png',
        name,
      }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      if (
        !['jpg', 'jpeg'].includes(ext ?? '') ||
        (mime && mime !== 'image/jpeg')
      )
        throw invalid()
      return {
        bytes: await normalizeRaster(bytes, 'image/jpeg'),
        type: 'image/jpeg',
        name,
      }
    }
    if (ext !== 'svg' || (mime && mime !== 'image/svg+xml')) throw invalid()
    const source = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes)
    validateSvg(source)
    initialization ??= initWasm(wasm).catch((error) => {
      initialization = undefined
      throw error
    })
    await initialization
    // Parse without rendering first, to choose a bounded output canvas in either orientation.
    const probe = new Resvg(source, { font: { loadSystemFonts: false } })
    let width: number, height: number
    try {
      width = probe.width
      height = probe.height
      dimensions(width, height)
      if (probe.imagesToResolve().length) throw invalid()
    } finally {
      probe.free()
    }
    const svg = new Resvg(source, {
      font: { loadSystemFonts: false },
      fitTo: { mode: width >= height ? 'width' : 'height', value: 512 },
    })
    try {
      const png = svg.render()
      try {
        if (png.width > 512 || png.height > 512) throw invalid()
        return {
          bytes: png.asPng().slice(),
          type: 'image/png',
          name: name.replace(/\.svg$/i, '') + '.png',
        }
      } finally {
        png.free()
      }
    } finally {
      svg.free()
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error
    if (
      error instanceof Error &&
      /allocation failed|out of memory/i.test(error.message)
    )
      throw new HTTPException(400, { message: 'logo_image_memory_limit' })
    throw invalid()
  }
}
