import { useEffect, useState } from 'react'
import {
  BellDot,
  Camera,
  ChevronLeft,
  Circle,
  Frame,
  Keyboard,
  Maximize2,
  Minimize2,
  Power,
  RotateCw,
  Square,
  Volume1,
  Volume2,
  Wifi
} from 'lucide-react'
import type { ControlCommand } from '@shared/ipc'
import { cx, IconButton, Tooltip } from '@components/ui'
import { takeScreenshot, toggleRecording } from '@features/capture/capture-actions'
import { actions, useApp } from './store'

function HomeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function RecentsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

const send = (command: ControlCommand): void => window.framecast.control(command)

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function RecordingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  return <span className="font-mono text-xs tabular-nums">{formatElapsed(now - startedAt)}</span>
}

const Divider = () => <div className="mx-1.5 h-5 w-px bg-line" />

export function BottomBar({ floating = false }: { floating?: boolean }) {
  const streaming = useApp((s) => s.mirror.phase === 'streaming')
  const recording = useApp((s) => s.recording)
  const fullscreen = useApp((s) => s.fullscreen)
  const keyboardFocused = useApp((s) => s.keyboardFocused)
  const off = !streaming

  return (
    <footer
      className={cx(
        'no-drag flex shrink-0 items-center justify-center gap-0.5',
        floating ? 'rounded-xl border border-line bg-surface/95 px-2 py-1.5 shadow-2xl backdrop-blur' : 'h-14 border-t border-line bg-surface px-4'
      )}
    >
      <IconButton label="Back" shortcut="Alt+B" disabled={off} onClick={() => send({ type: 'nav', key: 'back' })}>
        <ChevronLeft size={20} />
      </IconButton>
      <IconButton label="Home" shortcut="Alt+H" disabled={off} onClick={() => send({ type: 'nav', key: 'home' })}>
        <HomeIcon />
      </IconButton>
      <IconButton label="Recent apps" shortcut="Alt+S" disabled={off} onClick={() => send({ type: 'nav', key: 'recents' })}>
        <RecentsIcon />
      </IconButton>
      <Divider />
      <IconButton label="Rotate" shortcut="Alt+R" disabled={off} onClick={() => send({ type: 'rotate' })}>
        <RotateCw size={17} />
      </IconButton>
      <IconButton
        label="Notifications"
        shortcut="Alt+N"
        disabled={off}
        onClick={() => send({ type: 'panel', panel: 'notifications' })}
      >
        <BellDot size={17} />
      </IconButton>
      <IconButton label="Volume down" shortcut="Alt+↓" disabled={off} onClick={() => send({ type: 'nav', key: 'volumeDown' })}>
        <Volume1 size={17} />
      </IconButton>
      <IconButton label="Volume up" shortcut="Alt+↑" disabled={off} onClick={() => send({ type: 'nav', key: 'volumeUp' })}>
        <Volume2 size={17} />
      </IconButton>
      <IconButton label="Power" shortcut="Alt+P" disabled={off} onClick={() => send({ type: 'nav', key: 'power' })}>
        <Power size={16} />
      </IconButton>
      <Divider />
      <IconButton label="Screenshot" shortcut="Alt+C" disabled={off} onClick={() => void takeScreenshot(false)}>
        <Camera size={17} />
      </IconButton>
      <IconButton label="Screenshot with frame" shortcut="Alt+Shift+C" disabled={off} onClick={() => void takeScreenshot(true)}>
        <Frame size={17} />
      </IconButton>
      <Tooltip label={recording.active ? 'Stop recording' : 'Record screen'} shortcut="Alt+V">
        <button
          type="button"
          aria-label={recording.active ? 'Stop recording' : 'Record screen'}
          disabled={off && !recording.active}
          onClick={() => void toggleRecording()}
          className={cx(
            'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 transition-colors disabled:pointer-events-none disabled:opacity-35',
            recording.active ? 'bg-danger/15 text-danger' : 'text-muted hover:bg-raised hover:text-fg'
          )}
        >
          {recording.active ? (
            <>
              <Square size={11} fill="currentColor" className="animate-rec" />
              {recording.startedAt && <RecordingTimer startedAt={recording.startedAt} />}
            </>
          ) : (
            <Circle size={15} />
          )}
        </button>
      </Tooltip>
      <Divider />
      <IconButton
        label={fullscreen ? 'Exit full screen' : 'Full screen'}
        shortcut="F11"
        onClick={() => void actions.toggleFullscreen()}
      >
        {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </IconButton>
      {!floating && (
        <>
          <IconButton label="Wi-Fi connection" onClick={() => actions.openDialog('wireless')}>
            <Wifi size={17} />
          </IconButton>
          <div className="ml-3 flex w-40 items-center gap-1.5 text-[11px] text-subtle">
            {streaming && (
              <>
                <Keyboard size={13} className={keyboardFocused ? 'text-accent' : ''} />
                {keyboardFocused ? 'Typing goes to phone' : 'Click screen to type'}
              </>
            )}
          </div>
        </>
      )}
    </footer>
  )
}
