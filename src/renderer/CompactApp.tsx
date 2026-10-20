import { useEffect, useMemo, useRef, type HTMLAttributes } from 'react'
import {
  BellDot,
  Camera,
  ChevronLeft,
  Circle,
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Power,
  RotateCw,
  Square,
  Volume1,
  Volume2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { ControlCommand } from '@shared/ipc'
import { Toaster } from '@components/Toaster'
import { cx, IconButton } from '@components/ui'
import { takeScreenshot, toggleRecording } from '@features/capture/capture-actions'
import { computeFrameGeometry } from '@features/device-frame/geometry'
import { getProfile } from '@features/device-frame/profiles'
import { DeviceStage, useStageVideoSize } from '@features/mirroring/DeviceStage'
import { call } from './api'
import { useShortcuts, useTheme } from './App'
import { actions, useApp } from './store'

/** Transparent margin around the phone (room for its shadow). */
const PAD = 22
const GAP = 10
const TOOLBAR_W = 46
const TOOLBAR_MIN_H = 300
const ZOOM_STEP = 1.15

const send = (command: ControlCommand): void => window.framecast.control(command)

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function RecentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/** Pointer handlers that move the window while the device frame is held. */
function useWindowDrag(): HTMLAttributes<HTMLDivElement> {
  const dragging = useRef(false)
  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    window.framecast.dragWindow('end')
  }
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      dragging.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      window.framecast.dragWindow('start')
    },
    onPointerMove: () => {
      if (dragging.current) window.framecast.dragWindow('move')
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end
  }
}

const Sep = () => <div className="mx-auto my-1 h-px w-6 shrink-0 bg-line" />

/**
 * Emulator-style window: just the device frame and a vertical toolbar on its
 * right. The window is frameless and transparent and is resized to fit. Hold
 * the device frame to move it; the screen itself only receives touches.
 */
export function CompactApp() {
  useTheme()
  useShortcuts()
  const frame = useApp((s) => s.settings.frame)
  const display = useApp((s) => s.settings.display)
  const streaming = useApp((s) => s.mirror.phase === 'streaming')
  const recording = useApp((s) => s.recording.active)
  const video = useStageVideoSize()
  const off = !streaming
  const bezelHandlers = useWindowDrag()

  // Size the device so its long side is `compactSize`, but never larger than the screen.
  const layout = useMemo(() => {
    const geom = computeFrameGeometry(getProfile(frame.profile), video)
    const { width: ow, height: oh } = geom.outer
    const availH = window.screen.availHeight - 2 * PAD
    const availW = window.screen.availWidth - 2 * PAD - GAP - TOOLBAR_W
    const scale = Math.min(display.compactSize / Math.max(ow, oh), availH / oh, availW / ow)
    const frameW = Math.round(ow * scale)
    const frameH = Math.round(oh * scale)
    return {
      scale,
      frameH,
      winW: PAD + frameW + GAP + TOOLBAR_W + PAD,
      winH: Math.max(frameH, TOOLBAR_MIN_H) + 2 * PAD
    }
  }, [frame.profile, video.width, video.height, display.compactSize])

  useEffect(() => {
    void call('window:setCompactSize', { width: layout.winW, height: layout.winH }).catch(() => undefined)
  }, [layout.winW, layout.winH])

  const zoom = (factor: number): void => {
    const next = Math.round(Math.min(2000, Math.max(320, display.compactSize * factor)))
    if (next !== display.compactSize) void actions.updateSettings({ display: { compactSize: next } })
  }

  return (
    <div className="flex h-full w-full items-center" style={{ padding: PAD, gap: GAP }}>
      <DeviceStage variant="compact" scale={layout.scale} bezelHandlers={bezelHandlers} />
      <nav
        aria-label="Device controls"
        className="flex shrink-0 flex-col overflow-y-auto rounded-2xl border border-line bg-surface/95 py-1.5 shadow-xl backdrop-blur [&::-webkit-scrollbar]:hidden"
        style={{ width: TOOLBAR_W, maxHeight: Math.max(layout.frameH, TOOLBAR_MIN_H) }}
      >
        <div className="flex flex-col items-center">
          <IconButton label="Expand to full window" shortcut="Alt+M" tooltipSide="left" onClick={() => void actions.setWindowMode('full')}>
            <Maximize2 size={15} />
          </IconButton>
          <IconButton label="Minimize" tooltipSide="left" onClick={() => void call('window:minimize').catch(() => undefined)}>
            <Minus size={16} />
          </IconButton>
          <IconButton
            label={display.compactAlwaysOnTop ? 'Unpin (stop staying on top)' : 'Keep on top of other windows'}
            tooltipSide="left"
            active={display.compactAlwaysOnTop}
            onClick={() => void actions.updateSettings({ display: { compactAlwaysOnTop: !display.compactAlwaysOnTop } })}
          >
            {display.compactAlwaysOnTop ? <PinOff size={15} /> : <Pin size={15} />}
          </IconButton>
          <IconButton label="Close FrameCast" tooltipSide="left" className="hover:!bg-danger/15 hover:!text-danger" onClick={() => window.close()}>
            <X size={16} />
          </IconButton>
          <Sep />
          <IconButton label="Power" shortcut="Alt+P" tooltipSide="left" disabled={off} onClick={() => send({ type: 'nav', key: 'power' })}>
            <Power size={15} />
          </IconButton>
          <IconButton label="Volume up" shortcut="Alt+↑" tooltipSide="left" disabled={off} onClick={() => send({ type: 'nav', key: 'volumeUp' })}>
            <Volume2 size={16} />
          </IconButton>
          <IconButton label="Volume down" shortcut="Alt+↓" tooltipSide="left" disabled={off} onClick={() => send({ type: 'nav', key: 'volumeDown' })}>
            <Volume1 size={16} />
          </IconButton>
          <IconButton label="Rotate" shortcut="Alt+R" tooltipSide="left" disabled={off} onClick={() => send({ type: 'rotate' })}>
            <RotateCw size={15} />
          </IconButton>
          <IconButton label="Notifications" shortcut="Alt+N" tooltipSide="left" disabled={off} onClick={() => send({ type: 'panel', panel: 'notifications' })}>
            <BellDot size={15} />
          </IconButton>
          <Sep />
          <IconButton label="Back" shortcut="Alt+B" tooltipSide="left" disabled={off} onClick={() => send({ type: 'nav', key: 'back' })}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Home" shortcut="Alt+H" tooltipSide="left" disabled={off} onClick={() => send({ type: 'nav', key: 'home' })}>
            <HomeIcon />
          </IconButton>
          <IconButton label="Recent apps" shortcut="Alt+S" tooltipSide="left" disabled={off} onClick={() => send({ type: 'nav', key: 'recents' })}>
            <RecentsIcon />
          </IconButton>
          <Sep />
          <IconButton label="Screenshot" shortcut="Alt+C" tooltipSide="left" disabled={off} onClick={() => void takeScreenshot(false)}>
            <Camera size={15} />
          </IconButton>
          <IconButton
            label={recording ? 'Stop recording' : 'Record screen'}
            shortcut="Alt+V"
            tooltipSide="left"
            disabled={off && !recording}
            className={cx(recording && '!bg-danger/15 !text-danger')}
            onClick={() => void toggleRecording()}
          >
            {recording ? <Square size={11} fill="currentColor" className="animate-rec" /> : <Circle size={14} />}
          </IconButton>
          <Sep />
          <IconButton label="Zoom in" tooltipSide="left" disabled={display.compactSize >= 2000} onClick={() => zoom(ZOOM_STEP)}>
            <ZoomIn size={15} />
          </IconButton>
          <IconButton label="Zoom out" tooltipSide="left" disabled={display.compactSize <= 320} onClick={() => zoom(1 / ZOOM_STEP)}>
            <ZoomOut size={15} />
          </IconButton>
        </div>
      </nav>
      <Toaster />
    </div>
  )
}
