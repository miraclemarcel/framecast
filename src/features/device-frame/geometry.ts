import type { FrameProfile } from './profiles'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface FrameGeometry {
  landscape: boolean
  /** Full drawing size including protruding buttons, in video pixels. */
  outer: { width: number; height: number }
  /** Device body (rotated into the display orientation). */
  body: Rect & { radius: number }
  /** Exact screen area; matches the video aspect ratio. */
  screen: Rect & { radius: number }
  /** Portrait-space geometry used for drawing (rotated by the SVG when landscape). */
  portrait: {
    outer: { width: number; height: number }
    body: Rect & { radius: number }
    screen: Rect & { radius: number }
    rim: number
    unit: number
  }
}

/**
 * Build the frame around a video of the given size. All values are in video
 * pixels, so the screen rect maps 1:1 to the decoded frame.
 */
export function computeFrameGeometry(profile: FrameProfile, video: { width: number; height: number }): FrameGeometry {
  const landscape = video.width > video.height
  const shortSide = Math.min(video.width, video.height)
  const longSide = Math.max(video.width, video.height)
  const u = shortSide // unit for profile fractions

  const side = profile.bezel.side * u
  const top = profile.bezel.top * u
  const bottom = profile.bezel.bottom * u
  const depth = profile.buttons.length > 0 ? profile.buttonDepth * u : 0

  const bodyW = shortSide + 2 * side
  const bodyH = longSide + top + bottom
  const outerW = bodyW + 2 * depth
  const outerH = bodyH

  const pBody = { x: depth, y: 0, width: bodyW, height: bodyH, radius: profile.bodyRadius * u }
  const pScreen = { x: depth + side, y: top, width: shortSide, height: longSide, radius: profile.screenRadius * u }

  const portrait = {
    outer: { width: outerW, height: outerH },
    body: pBody,
    screen: pScreen,
    rim: profile.rim * u,
    unit: u
  }

  if (!landscape) {
    return { landscape, outer: portrait.outer, body: pBody, screen: pScreen, portrait }
  }

  // Rotate 90° counter-clockwise: the portrait top edge becomes the left edge.
  const rot = (r: Rect & { radius: number }) => ({ ...rotateRectCcw(r, outerW), radius: r.radius })
  return {
    landscape,
    outer: { width: outerH, height: outerW },
    body: rot(pBody),
    screen: rot(pScreen),
    portrait
  }
}

/** Rotate a rect 90° counter-clockwise inside a container of width `containerWidth`. */
export function rotateRectCcw(r: Rect, containerWidth: number): Rect {
  return { x: r.y, y: containerWidth - r.x - r.width, width: r.height, height: r.width }
}

/**
 * Scale factor that fits `content` inside `container` with `padding` on every
 * side. A fixed zoom (number) is used as-is.
 */
export function fitScale(
  content: { width: number; height: number },
  container: { width: number; height: number },
  padding: number,
  zoom: 'fit' | number = 'fit'
): number {
  if (typeof zoom === 'number') return zoom
  const availW = Math.max(1, container.width - 2 * padding)
  const availH = Math.max(1, container.height - 2 * padding)
  if (content.width <= 0 || content.height <= 0) return 1
  return Math.min(availW / content.width, availH / content.height)
}
