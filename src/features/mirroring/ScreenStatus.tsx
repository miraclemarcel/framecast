import { AlertTriangle, Loader2, Play, ShieldQuestion, Smartphone, Unplug, Wifi } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@components/ui'
import { actions, useApp } from '../../renderer/store'
import { deviceDisplayName } from '../devices/selection'

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-y-auto bg-[#0a0b0d] px-[9%] text-center text-[#e6e9ee]">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] text-[#aab3c0]">{icon}</div>
      <p className="text-[15px] font-semibold">{title}</p>
      {children}
    </div>
  )
}

const muted = 'text-xs leading-relaxed text-[#9aa3b0]'

/** What the phone "screen" shows when there is no live video. */
export function ScreenStatus() {
  const mirror = useApp((s) => s.mirror)
  const devices = useApp((s) => s.devices)
  const selected = useApp((s) => s.selectedSerial)
  const adb = useApp((s) => s.adb)
  const ready = useApp((s) => s.ready)
  const device = devices.find((d) => d.serial === (mirror.serial ?? selected))

  if (!ready) return <Panel icon={<Loader2 size={20} className="animate-spin" />} title="Starting FrameCast" />

  if (!adb.available) {
    return (
      <Panel icon={<AlertTriangle size={20} />} title="ADB is not available">
        <p className={muted}>{adb.error?.hint ?? 'FrameCast needs Android Debug Bridge to talk to your phone.'}</p>
        <Button size="sm" onClick={() => actions.openDialog('settings')}>
          Connection settings
        </Button>
      </Panel>
    )
  }

  if (mirror.phase === 'starting' || mirror.phase === 'stopping') {
    return (
      <Panel icon={<Loader2 size={20} className="animate-spin" />} title={mirror.phase === 'stopping' ? 'Stopping…' : 'Connecting'}>
        <p className={muted}>{mirror.step ?? 'Preparing'}…</p>
      </Panel>
    )
  }

  if (mirror.phase === 'streaming') {
    return <Panel icon={<Loader2 size={20} className="animate-spin" />} title="Waiting for video" />
  }

  if (mirror.phase === 'reconnecting') {
    const present = device?.state === 'device'
    return (
      <Panel icon={present ? <Loader2 size={20} className="animate-spin" /> : <Unplug size={20} />} title="Reconnecting">
        <p className={muted}>
          {present ? `Attempt ${mirror.reconnectAttempt ?? 1}…` : 'Waiting for the phone to come back. Check the cable or Wi-Fi.'}
        </p>
        <Button size="sm" variant="ghost" onClick={() => void actions.stopMirroring()}>
          Cancel
        </Button>
      </Panel>
    )
  }

  if (mirror.phase === 'error' && mirror.error) {
    const e = mirror.error
    return (
      <Panel icon={<AlertTriangle size={20} className="text-[#f2b84b]" />} title={e.message}>
        {e.hint && <p className={muted}>{e.hint}</p>}
        {e.detail && (
          <details className="w-full text-left">
            <summary className="cursor-pointer text-center text-[11px] text-[#6f7885]">Technical details</summary>
            <pre className="mt-2 max-h-28 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] whitespace-pre-wrap text-[#8b94a1] select-text">
              {e.detail}
            </pre>
          </details>
        )}
        <div className="flex gap-2">
          {mirror.serial && (
            <Button size="sm" variant="primary" onClick={() => void actions.startMirroring(mirror.serial!)}>
              Try again
            </Button>
          )}
          <Button size="sm" onClick={() => actions.openDialog('setup')}>
            Help
          </Button>
        </div>
      </Panel>
    )
  }

  if (!device) {
    return (
      <Panel icon={<Smartphone size={20} />} title="Connect your phone">
        <p className={muted}>
          Plug in your Android phone with a USB cable and enable <b className="text-[#cfd5de]">USB debugging</b> in Developer options.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="primary" onClick={() => actions.openDialog('setup')}>
            Setup guide
          </Button>
          <Button size="sm" onClick={() => actions.openDialog('wireless')}>
            <Wifi size={13} /> Wi-Fi
          </Button>
        </div>
      </Panel>
    )
  }

  if (device.state === 'unauthorized' || device.state === 'authorizing') {
    return (
      <Panel icon={<ShieldQuestion size={20} />} title="Allow USB debugging">
        <p className={muted}>
          Unlock your phone and tap <b className="text-[#cfd5de]">Allow</b> on the “Allow USB debugging?” prompt. Tick “Always allow from this
          computer” to skip this next time.
        </p>
        <p className="text-[11px] text-[#6f7885]">No prompt? Unplug and replug the cable.</p>
      </Panel>
    )
  }

  if (device.state !== 'device') {
    return (
      <Panel icon={<AlertTriangle size={20} />} title={device.state === 'no permissions' ? 'USB driver needed' : `Device ${device.state}`}>
        <p className={muted}>
          {device.state === 'no permissions'
            ? 'Install your phone maker’s USB driver (or the Google USB Driver) and replug the cable.'
            : 'Unplug and replug the cable. If it persists, toggle USB debugging off and on.'}
        </p>
      </Panel>
    )
  }

  return (
    <Panel icon={<Smartphone size={20} />} title={deviceDisplayName(device)}>
      <p className={muted}>Ready to mirror{device.kind === 'wireless' ? ' over Wi-Fi' : ' over USB'}.</p>
      <Button variant="primary" onClick={() => void actions.startMirroring(device.serial)}>
        <Play size={14} /> Start mirroring
      </Button>
    </Panel>
  )
}
