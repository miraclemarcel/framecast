export interface ClientRect {
  left: number
  top: number
  width: number
  height: number
}

export interface VideoPoint {
  x: number
  y: number
  /** True if the original point was outside the displayed video area (and was clamped). */
  clamped: boolean
}

/**
 * Map a pointer position in client (CSS) coordinates to video pixel coordinates.
 *
 * The element may letterbox the video (object-fit: contain), so the displayed
 * content area is computed from the aspect ratios. Points outside are clamped to
 * the nearest edge, matching scrcpy's behaviour during drags.
 */
export function clientToVideo(
  clientX: number,
  clientY: number,
  rect: ClientRect,
  video: { width: number; height: number }
): VideoPoint | null {
  if (rect.width <= 0 || rect.height <= 0 || video.width <= 0 || video.height <= 0) return null

  const scale = Math.min(rect.width / video.width, rect.height / video.height)
  const shownW = video.width * scale
  const shownH = video.height * scale
  const offsetX = rect.left + (rect.width - shownW) / 2
  const offsetY = rect.top + (rect.height - shownH) / 2

  const rawX = (clientX - offsetX) / scale
  const rawY = (clientY - offsetY) / scale
  const x = Math.min(video.width - 1, Math.max(0, Math.floor(rawX)))
  const y = Math.min(video.height - 1, Math.max(0, Math.floor(rawY)))
  const clamped = rawX < 0 || rawY < 0 || rawX >= video.width || rawY >= video.height
  return { x, y, clamped }
}

/** Point mirrored through the screen center (used for the Ctrl+drag pinch gesture). */
export function mirrorPoint(p: { x: number; y: number }, video: { width: number; height: number }): { x: number; y: number } {
  return {
    x: Math.min(video.width - 1, Math.max(0, video.width - 1 - p.x)),
    y: Math.min(video.height - 1, Math.max(0, video.height - 1 - p.y))
  }
}

/** Convert a WheelEvent delta into scrcpy scroll units (one notch ≈ 1), clamped to [-16, 16]. */
export function wheelToScroll(deltaX: number, deltaY: number, deltaMode: number): { h: number; v: number } {
  // deltaMode: 0 = pixels (≈100 per notch on Windows), 1 = lines (≈3 per notch), 2 = pages.
  const divisor = deltaMode === 0 ? 100 : deltaMode === 1 ? 3 : 1
  const clamp = (n: number): number => Math.max(-16, Math.min(16, n))
  // Android scroll axes are inverted relative to DOM deltas.
  return { h: clamp(-deltaX / divisor), v: clamp(-deltaY / divisor) }
}
