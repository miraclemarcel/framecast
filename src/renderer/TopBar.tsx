import { CircleHelp, Loader2, PanelRight, Play, Settings2, Square } from 'lucide-react'
import { Button, IconButton } from '@components/ui'
import { DeviceSelector } from '@features/devices/DeviceSelector'
import { actions, useApp } from './store'

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="1.5" width="14" height="21" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="8" y="5" width="8" height="12" rx="1.2" fill="currentColor" opacity="0.35" />
      <circle cx="12" cy="3.9" r="0.9" fill="currentColor" />
    </svg>
  )
}

export function TopBar() {
  const mirror = useApp((s) => s.mirror)
  const selected = useApp((s) => s.devices.find((d) => d.serial === s.selectedSerial))
  const infoPanel = useApp((s) => s.settings.display.showInfoPanel)

  const active = mirror.phase === 'streaming' || mirror.phase === 'starting' || mirror.phase === 'reconnecting'
  const busy = mirror.phase === 'starting' || mirror.phase === 'stopping'

  return (
    // Right padding leaves room for the native window controls (titleBarOverlay).
    <header className="drag flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface pr-[150px] pl-3">
      <div className="flex items-center gap-2 text-fg">
        <span className="text-accent">
          <Logo />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">FrameCast</span>
      </div>
      <div className="mx-1 h-5 w-px bg-line" />
      <DeviceSelector />
      <div className="no-drag">
        {active ? (
          <Button variant="secondary" onClick={() => void actions.stopMirroring()} disabled={mirror.phase === 'stopping'}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Square size={12} fill="currentColor" />}
            {mirror.phase === 'starting' ? 'Connecting…' : 'Stop'}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!selected || selected.state !== 'device' || busy}
            onClick={() => void actions.startMirroring()}
          >
            <Play size={13} fill="currentColor" /> Mirror
          </Button>
        )}
      </div>
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-0.5">
        <IconButton label="Setup guide" tooltipSide="bottom" onClick={() => actions.openDialog('setup')}>
          <CircleHelp size={17} />
        </IconButton>
        <IconButton
          label={infoPanel ? 'Hide device info' : 'Show device info'}
          tooltipSide="bottom"
          active={infoPanel}
          onClick={() => void actions.updateSettings({ display: { showInfoPanel: !infoPanel } })}
        >
          <PanelRight size={17} />
        </IconButton>
        <IconButton label="Settings" tooltipSide="bottom" onClick={() => actions.openDialog('settings')}>
          <Settings2 size={17} />
        </IconButton>
      </div>
    </header>
  )
}
