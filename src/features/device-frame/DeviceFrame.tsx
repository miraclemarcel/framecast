import { memo, useMemo, type HTMLAttributes, type ReactNode } from 'react'
import type { FrameFinishId, FrameProfileId } from '@shared/settings'
import type { Size } from '@shared/types'
import { computeFrameGeometry, fitScale } from './geometry'
import { renderFrameSvg, svgDataUrl } from './frame-svg'
import { getFinish, getProfile } from './profiles'

export interface DeviceFrameProps {
  video: Size
  profile: FrameProfileId
  finish: FrameFinishId
  showButtons: boolean
  shadow: boolean
  container: Size
  padding: number
  zoom: 'fit' | number
  /** Content placed exactly over the screen area (the live canvas). */
  children: ReactNode
  /** Content drawn over the screen but under the camera cutout (status overlays). */
  screenOverlay?: ReactNode
  /**
   * Pointer handlers for the device body (bezel). The screen sits above this
   * layer, so only presses on the frame itself reach them (used to move the
   * compact window).
   */
  bezelHandlers?: HTMLAttributes<HTMLDivElement>
}

/**
 * Renders the device body (SVG) around a screen slot. The slot is sized to the
 * video's exact aspect ratio, so the canvas inside fills it without distortion.
 */
export const DeviceFrame = memo(function DeviceFrame(props: DeviceFrameProps) {
  const { video, profile: profileId, finish: finishId, showButtons, shadow, container, padding, zoom } = props
  const profile = getProfile(profileId)
  const finish = getFinish(finishId)

  const geom = useMemo(() => computeFrameGeometry(profile, video), [profile, video.width, video.height])
  const urls = useMemo(() => {
    const svg = renderFrameSvg(geom, profile, finish, { showButtons })
    return { base: svgDataUrl(svg.base), overlay: svg.overlay ? svgDataUrl(svg.overlay) : null }
  }, [geom, profile, finish, showButtons])

  const scale = fitScale(geom.outer, container, padding, zoom)
  const s = geom.screen

  return (
    <div className="relative shrink-0" style={{ width: geom.outer.width * scale, height: geom.outer.height * scale }}>
      <img
        src={urls.base}
        alt=""
        draggable={false}
        className={`pointer-events-none absolute inset-0 h-full w-full select-none ${shadow ? 'frame-shadow' : ''}`}
      />
      {props.bezelHandlers && (
        <div
          {...props.bezelHandlers}
          aria-hidden="true"
          className="absolute cursor-grab active:cursor-grabbing"
          style={{
            left: geom.body.x * scale,
            top: geom.body.y * scale,
            width: geom.body.width * scale,
            height: geom.body.height * scale,
            borderRadius: geom.body.radius * scale,
            touchAction: 'none'
          }}
        />
      )}
      <div
        className="absolute overflow-hidden bg-black"
        style={{
          left: s.x * scale,
          top: s.y * scale,
          width: s.width * scale,
          height: s.height * scale,
          borderRadius: s.radius * scale
        }}
      >
        {props.children}
        {props.screenOverlay}
      </div>
      {urls.overlay && (
        <img
          src={urls.overlay}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
        />
      )}
    </div>
  )
})
