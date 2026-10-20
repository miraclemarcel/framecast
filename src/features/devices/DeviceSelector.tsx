import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, RefreshCw, Smartphone, Unplug, Wifi } from 'lucide-react'
import { call } from '../../renderer/api'
import { actions, useApp } from '../../renderer/store'
import { cx, StatusDot } from '@components/ui'
import { deviceDisplayName, deviceStatus } from './selection'

export function DeviceSelector() {
  const devices = useApp((s) => s.devices)
  const selectedSerial = useApp((s) => s.selectedSerial)
  const mirror = useApp((s) => s.mirror)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const selected = devices.find((d) => d.serial === selectedSerial)
  const locked = mirror.phase === 'starting' || mirror.phase === 'stopping'
  const tone =
    mirror.phase === 'streaming'
      ? 'ready'
      : mirror.phase === 'error'
        ? 'error'
        : mirror.phase === 'starting' || mirror.phase === 'reconnecting'
          ? 'warning'
          : selected
            ? deviceStatus(selected).tone
            : 'muted'

  const choose = (serial: string): void => {
    setOpen(false)
    actions.selectDevice(serial)
    // Switching devices while mirroring restarts on the new one.
    if (mirror.phase === 'streaming' && mirror.serial !== serial) void actions.startMirroring(serial)
  }

  return (
    <div ref={rootRef} className="no-drag relative">
      <button
        type="button"
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 min-w-56 items-center gap-2 rounded-md border border-line bg-raised pr-2 pl-2.5 text-left hover:border-line-strong disabled:opacity-60"
      >
        <StatusDot tone={tone} pulse={mirror.phase === 'starting' || mirror.phase === 'reconnecting'} />
        <span className="min-w-0 flex-1 truncate">
          {selected ? deviceDisplayName(selected) : devices.length ? 'Select a device' : 'No device connected'}
        </span>
        {selected && <span className="text-xs text-subtle">{selected.kind === 'wireless' ? 'Wi-Fi' : 'USB'}</span>}
        <ChevronDown size={14} className="text-subtle" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-30 mt-1.5 w-80 overflow-hidden rounded-lg border border-line bg-overlay shadow-2xl">
          <div className="max-h-72 overflow-y-auto p-1" role="listbox">
            {devices.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted">No devices found. Connect a phone with USB debugging enabled.</p>
            )}
            {devices.map((d) => {
              const st = deviceStatus(d)
              return (
                <div key={d.serial} className="group flex items-center">
                  <button
                    role="option"
                    aria-selected={d.serial === selectedSerial}
                    onClick={() => choose(d.serial)}
                    className={cx(
                      'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-raised',
                      d.serial === selectedSerial && 'bg-raised'
                    )}
                  >
                    {d.kind === 'wireless' ? <Wifi size={15} className="text-muted" /> : <Smartphone size={15} className="text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{deviceDisplayName(d)}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                        <StatusDot tone={st.tone} /> {st.label}
                        {d.details?.androidVersion && ` · Android ${d.details.androidVersion}`}
                      </span>
                    </span>
                    {d.serial === selectedSerial && <Check size={14} className="text-accent" />}
                  </button>
                  {d.kind === 'wireless' && (
                    <button
                      title="Disconnect Wi-Fi device"
                      aria-label="Disconnect Wi-Fi device"
                      onClick={() =>
                        void call('devices:disconnectWireless', { serial: d.serial }).catch((e) => actions.errorToast('Disconnect failed', e))
                      }
                      className="mr-1 rounded p-1.5 text-subtle opacity-0 group-hover:opacity-100 hover:bg-raised hover:text-fg"
                    >
                      <Unplug size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex border-t border-line p-1 text-xs">
            <MenuAction icon={<Wifi size={13} />} label="Wi-Fi…" onClick={() => (setOpen(false), actions.openDialog('wireless'))} />
            <MenuAction icon={<BookOpen size={13} />} label="Setup guide" onClick={() => (setOpen(false), actions.openDialog('setup'))} />
            <MenuAction icon={<RefreshCw size={13} />} label="Refresh" onClick={() => void actions.refreshDevices()} />
          </div>
        </div>
      )}
    </div>
  )
}

function MenuAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-muted hover:bg-raised hover:text-fg">
      {icon}
      {label}
    </button>
  )
}
