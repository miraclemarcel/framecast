import type { Settings } from '@shared/settings'
import { computeFrameGeometry } from './geometry'
import { renderFrameSvg, svgDataUrl } from './frame-svg'
import { getFinish, getProfile } from './profiles'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

/**
 * Compose a device-framed PNG from a raw screenshot: the frame is generated at
 * the screenshot's native resolution, so the screen content is not resampled.
 * A transparent margin leaves room for the drop shadow.
 */
export async function composeFramedScreenshot(png: Uint8Array, frame: Settings['frame']): Promise<Uint8Array> {
  const shotUrl = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
  try {
    const shot = await loadImage(shotUrl)
    const video = { width: shot.naturalWidth, height: shot.naturalHeight }
    const profile = getProfile(frame.profile)
    const geom = computeFrameGeometry(profile, video)
    const svg = renderFrameSvg(geom, profile, getFinish(frame.finish), { showButtons: frame.showButtons })
    const [base, overlay] = await Promise.all([
      loadImage(svgDataUrl(svg.base)),
      svg.overlay ? loadImage(svgDataUrl(svg.overlay)) : Promise.resolve(null)
    ])

    const margin = frame.showShadow ? Math.round(Math.min(video.width, video.height) * 0.08) : 0
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(geom.outer.width + 2 * margin)
    canvas.height = Math.ceil(geom.outer.height + 2 * margin)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')

    ctx.translate(margin, margin)
    if (frame.showShadow) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = margin * 0.6
      ctx.shadowOffsetY = margin * 0.25
      ctx.drawImage(base, 0, 0, geom.outer.width, geom.outer.height)
      ctx.restore()
    } else {
      ctx.drawImage(base, 0, 0, geom.outer.width, geom.outer.height)
    }

    const s = geom.screen
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(s.x, s.y, s.width, s.height, s.radius)
    ctx.clip()
    ctx.drawImage(shot, s.x, s.y, s.width, s.height)
    ctx.restore()
    if (overlay) ctx.drawImage(overlay, 0, 0, geom.outer.width, geom.outer.height)

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
    )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(shotUrl)
  }
}
