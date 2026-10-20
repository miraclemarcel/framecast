import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import type { Size } from '@shared/types'
import { DeviceFrame } from '../device-frame/DeviceFrame'
import { actions, useApp } from '../../renderer/store'
import { MirrorScreen } from './MirrorScreen'
import { ScreenStatus } from './ScreenStatus'

const DEFAULT_VIDEO: Size = { width: 1080, height: 2400 }

function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/**
 * Size of the content shown in the frame: the live video when mirroring,
 * otherwise the selected phone's real screen proportions (portrait).
 */
export function useStageVideoSize(): Size {
  const videoSize = useApp((s) => s.mirror.videoSize)
  const details = useApp((s) => s.devices.find((d) => d.serial === (s.mirror.serial ?? s.selectedSerial))?.details)
  if (videoSize) return videoSize
  if (details?.screenWidth && details.screenHeight) {
    return {
      width: Math.min(details.screenWidth, details.screenHeight),
      height: Math.max(details.screenWidth, details.screenHeight)
    }
  }
  return DEFAULT_VIDEO
}

export type StageVariant = 'workspace' | 'fullscreen' | 'compact'

/**
 * The device frame wrapping the live screen.
 *  - workspace / fullscreen: fit to the available area;
 *  - compact: drawn at a fixed `scale` (the window is sized around it).
 */
export function DeviceStage({
  variant,
  scale,
  bezelHandlers
}: {
  variant: StageVariant
  scale?: number
  /** Compact mode: pressing the frame (not the screen) moves the window. */
  bezelHandlers?: HTMLAttributes<HTMLDivElement>
}) {
  const [ref, container] = useElementSize<HTMLDivElement>()
  const frame = useApp((s) => s.settings.frame)
  const zoom = useApp((s) => s.settings.display.scaling)
  const mirror = useApp((s) => s.mirror)
  const [videoVisible, setVideoVisible] = useState(false)
  const streaming = mirror.phase === 'streaming'
  const video = useStageVideoSize()

  useEffect(() => {
    if (!streaming) setVideoVisible(false)
  }, [streaming])

  const onStats = useCallback((stats: { fps: number; kbps: number }) => {
    const prev = useApp.getState().stats
    if (prev.fps !== stats.fps || prev.kbps !== stats.kbps) useApp.setState({ stats })
  }, [])

  const onFatal = useCallback((message: string) => {
    actions.toast({
      level: 'error',
      title: 'Video decoding failed',
      message,
      hint: 'Try a lower resolution in Settings → Video, then restart mirroring.'
    })
  }, [])

  const fullscreen = variant === 'fullscreen'
  const compact = variant === 'compact'
  const showFrame = !fullscreen || frame.frameInFullscreen
  const hideStatus = streaming && videoVisible

  const background = fullscreen ? 'bg-black' : compact ? '' : 'workspace-bg'
  const ready = compact || container.width > 0

  return (
    <div
      ref={ref}
      className={`relative flex items-center justify-center ${compact ? '' : 'h-full w-full overflow-auto'} ${background}`}
    >
      {ready && (
        <DeviceFrame
          video={video}
          profile={showFrame ? frame.profile : 'none'}
          finish={frame.finish}
          showButtons={frame.showButtons}
          shadow={frame.showShadow && !fullscreen}
          container={container}
          padding={fullscreen || compact ? 0 : Math.max(24, Math.min(container.width, container.height) * 0.05)}
          zoom={compact ? (scale ?? 0.35) : fullscreen ? 'fit' : zoom}
          screenOverlay={hideStatus ? null : <div className="absolute inset-0"><ScreenStatus /></div>}
          bezelHandlers={bezelHandlers}
        >
          <MirrorScreen
            videoSize={mirror.videoSize ?? null}
            streaming={streaming}
            onVideoVisible={setVideoVisible}
            onStats={onStats}
            onFatal={onFatal}
            onKeyboardFocus={(keyboardFocused) => useApp.setState({ keyboardFocused })}
          />
        </DeviceFrame>
      )}
    </div>
  )
}
