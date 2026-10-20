import type { FrameGeometry } from './geometry'
import type { FrameFinish, FrameProfile } from './profiles'

export interface FrameSvgOptions {
  showButtons: boolean
}

export interface FrameSvg {
  /** Body, bezel and buttons — drawn below the screen. */
  base: string
  /** Camera cutout — drawn above the screen, never intercepting input. */
  overlay: string
  width: number
  height: number
}

const r2 = (n: number): string => (Math.round(n * 100) / 100).toString()

function roundedRect(x: number, y: number, w: number, h: number, r: number, attrs: string): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(radius)}" ry="${r2(radius)}" ${attrs}/>`
}

function wrap(geom: FrameGeometry, content: string, defs = ''): string {
  const { width, height } = geom.outer
  // Portrait artwork is rotated 90° counter-clockwise into landscape: (x, y) → (y, W − x).
  const transform = geom.landscape ? ` transform="translate(0 ${r2(geom.portrait.outer.width)}) rotate(-90)"` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(width)} ${r2(height)}" width="${r2(width)}" height="${r2(height)}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    `<g${transform}>${content}</g></svg>`
  )
}

/** Build the procedural SVG artwork for a frame profile and finish. */
export function renderFrameSvg(
  geom: FrameGeometry,
  profile: FrameProfile,
  finish: FrameFinish,
  opts: FrameSvgOptions
): FrameSvg {
  const { body, screen, rim, unit: u } = geom.portrait
  const parts: string[] = []
  const hasBody = profile.bezel.side > 0

  if (hasBody && opts.showButtons) {
    const depth = profile.buttonDepth * u
    for (const b of profile.buttons) {
      const y = body.y + b.top * body.height
      const len = b.length * body.height
      const overlap = depth * 1.5
      const x = b.side === 'right' ? body.x + body.width - overlap : body.x - depth
      parts.push(roundedRect(x, y, depth + overlap, len, depth * 0.9, `fill="${finish.button}"`))
      // Subtle edge highlight on the button.
      const hx = b.side === 'right' ? x + depth + overlap - depth * 0.45 : x + depth * 0.2
      parts.push(roundedRect(hx, y + depth, depth * 0.25, len - 2 * depth, depth * 0.12, `fill="${finish.rimHighlight}"`))
    }
  }

  const defs = hasBody
    ? `<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${finish.rim[0]}"/><stop offset="1" stop-color="${finish.rim[1]}"/></linearGradient>`
    : ''

  if (hasBody) {
    parts.push(roundedRect(body.x, body.y, body.width, body.height, body.radius, 'fill="url(#rim)"'))
    const hl = Math.max(1, u * 0.0028)
    parts.push(
      roundedRect(
        body.x + hl / 2,
        body.y + hl / 2,
        body.width - hl,
        body.height - hl,
        body.radius - hl / 2,
        `fill="none" stroke="${finish.rimHighlight}" stroke-width="${r2(hl)}"`
      )
    )
    // Glass front panel inside the rim.
    parts.push(
      roundedRect(
        body.x + rim,
        body.y + rim,
        body.width - 2 * rim,
        body.height - 2 * rim,
        Math.max(0, body.radius - rim),
        `fill="${finish.bezel}"`
      )
    )
    if (profile.speaker > 0) {
      const w = profile.speaker * screen.width
      const h = Math.max(2, u * 0.0065)
      const topBezel = screen.y - body.y
      parts.push(
        roundedRect(
          body.x + body.width / 2 - w / 2,
          body.y + Math.max(rim + h, topBezel * 0.42) - h / 2,
          w,
          h,
          h / 2,
          'fill="#1d2024"'
        )
      )
    }
  }

  // Black screen backdrop, visible before the first video frame arrives.
  parts.push(roundedRect(screen.x, screen.y, screen.width, screen.height, screen.radius, 'fill="#000"'))

  const overlay: string[] = []
  const cutout = profile.cutout
  if (cutout.type === 'punch') {
    const d = cutout.diameter * u
    const cx = cutout.align === 'center' ? screen.x + screen.width / 2 : screen.x + screen.width * 0.09
    const cy = screen.y + cutout.top * u
    overlay.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(d / 2)}" fill="#020203"/>`)
    overlay.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(d * 0.27)}" fill="#0b1018"/>`)
    overlay.push(
      `<circle cx="${r2(cx - d * 0.08)}" cy="${r2(cy - d * 0.08)}" r="${r2(d * 0.07)}" fill="rgba(140,170,255,0.35)"/>`
    )
  } else if (cutout.type === 'notch') {
    const w = cutout.width * screen.width
    const h = cutout.height * u
    const r = cutout.radius * u
    const x0 = screen.x + screen.width / 2 - w / 2
    const x1 = x0 + w
    const y0 = screen.y - 1
    const y1 = screen.y + h
    const f = r * 0.6 // small fillet joining the screen edge
    overlay.push(
      `<path fill="#020203" d="M${r2(x0 - f)} ${r2(y0)} Q${r2(x0)} ${r2(y0)} ${r2(x0)} ${r2(y0 + f)} ` +
        `L${r2(x0)} ${r2(y1 - r)} Q${r2(x0)} ${r2(y1)} ${r2(x0 + r)} ${r2(y1)} ` +
        `L${r2(x1 - r)} ${r2(y1)} Q${r2(x1)} ${r2(y1)} ${r2(x1)} ${r2(y1 - r)} ` +
        `L${r2(x1)} ${r2(y0 + f)} Q${r2(x1)} ${r2(y0)} ${r2(x1 + f)} ${r2(y0)} Z"/>`
    )
    const sw = w * 0.22
    const sh = Math.max(2, h * 0.09)
    overlay.push(roundedRect(x0 + w / 2 - sw / 2, screen.y + h * 0.3, sw, sh, sh / 2, 'fill="#16191d"'))
    overlay.push(`<circle cx="${r2(x0 + w * 0.7)}" cy="${r2(screen.y + h * 0.45)}" r="${r2(h * 0.17)}" fill="#0b1018"/>`)
  }

  return {
    base: wrap(geom, parts.join(''), defs),
    overlay: overlay.length ? wrap(geom, overlay.join('')) : '',
    width: geom.outer.width,
    height: geom.outer.height
  }
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
