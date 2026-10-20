import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** The workspace: a centered device frame wrapping the live screen, scaled to the window. */
export function DeviceStage({ fullscreen }: { fullscreen: boolean }) {
  const [ref, container] = useElementSize<HTMLDivElement>()
  const frame = useApp((s) => s.settings.frame)
  const zoom = useApp((s) => s.settings.display.scaling)
  const mirror = useApp((s) => s.mirror)
  const selected = useApp((s) => s.devices.find((d) => d.serial === (s.mirror.serial ?? s.selectedSerial)))
  const [videoVisible, setVideoVisible] = useState(false)
  const streaming = mirror.phase === 'streaming'

  // Without video yet, preview the frame at the selected phone's real proportions.
  const details = selected?.details
  const video: Size =
    mirror.videoSize ??
    (details?.screenWidth && details.screenHeight
      ? { width: Math.min(details.screenWidth, details.screenHeight), height: Math.max(details.screenWidth, details.screenHeight) }
      : DEFAULT_VIDEO)

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

  const showFrame = !fullscreen || frame.frameInFullscreen
  const hideStatus = streaming && videoVisible

  return (
    <div ref={ref} className={`relative flex h-full w-full items-center justify-center overflow-auto ${fullscreen ? 'bg-black' : 'workspace-bg'}`}>
      {container.width > 0 && (
        <DeviceFrame
          video={video}
          profile={showFrame ? frame.profile : 'none'}
          finish={frame.finish}
          showButtons={frame.showButtons}
          shadow={frame.showShadow && !fullscreen}
          container={container}
          padding={fullscreen ? 0 : Math.max(24, Math.min(container.width, container.height) * 0.05)}
          zoom={fullscreen ? 'fit' : zoom}
          screenOverlay={hideStatus ? null : <div className="absolute inset-0"><ScreenStatus /></div>}
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
