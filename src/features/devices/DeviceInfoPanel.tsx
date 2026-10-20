import type { ReactNode } from 'react'
import { Kbd, StatusDot } from '@components/ui'
import { useApp } from '../../renderer/store'
import { SHORTCUTS } from '../mirroring/shortcuts'
import { deviceDisplayName, deviceStatus } from './selection'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-muted">{label}</span>
      <span className={`min-w-0 truncate text-right select-text ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</span>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function DeviceInfoPanel() {
  const mirror = useApp((s) => s.mirror)
  const device = useApp((s) => s.devices.find((d) => d.serial === (s.mirror.serial ?? s.selectedSerial)))
  const stats = useApp((s) => s.stats)
  const video = useApp((s) => s.settings.video)
  const recording = useApp((s) => s.recording)
  const adb = useApp((s) => s.adb)
  const d = device?.details
  const streaming = mirror.phase === 'streaming'

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <Section title="Device">
        {device ? (
          <>
            <p className="mb-1 text-[14px] font-medium">{deviceDisplayName(device)}</p>
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
              <StatusDot tone={deviceStatus(device).tone} /> {deviceStatus(device).label}
            </p>
            <Row label="Android" value={d?.androidVersion ? `${d.androidVersion} (API ${d.sdkInt ?? '?'})` : undefined} />
            <Row label="Manufacturer" value={d?.manufacturer} />
            <Row label="Screen" value={d?.screenWidth ? `${d.screenWidth} × ${d.screenHeight}` : undefined} />
            <Row label="Density" value={d?.density ? `${d.density} dpi` : undefined} />
            <Row label="Connection" value={device.kind === 'wireless' ? 'Wi-Fi (TCP/IP)' : 'USB'} />
            <Row label="Serial" value={device.serial} mono />
          </>
        ) : (
          <p className="text-muted">No device selected.</p>
        )}
      </Section>

      <Section title="Stream">
        <Row
          label="Status"
          value={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot
                tone={streaming ? 'ready' : mirror.phase === 'error' ? 'error' : mirror.phase === 'idle' ? 'muted' : 'warning'}
              />
              {mirror.phase === 'streaming' ? 'Live' : mirror.phase.charAt(0).toUpperCase() + mirror.phase.slice(1)}
            </span>
          }
        />
        <Row label="Resolution" value={streaming && mirror.videoSize ? `${mirror.videoSize.width} × ${mirror.videoSize.height}` : undefined} />
        <Row label="Frame rate" value={streaming ? `${stats.fps} fps` : undefined} />
        <Row label="Bitrate" value={streaming ? `${(stats.kbps / 1000).toFixed(1)} Mbit/s` : undefined} />
        <Row label="Codec" value={streaming ? 'H.264' : undefined} />
        <Row
          label="Limits"
          value={`${video.maxSize ? `${video.maxSize}px` : 'native'} · ${video.bitRate / 1e6} Mbit/s · ${video.maxFps || '∞'} fps`}
        />
        {recording.active && (
          <Row
            label="Recording"
            value={
              <span className="inline-flex items-center gap-1.5 text-danger">
                <StatusDot tone="error" pulse /> {formatBytes(recording.bytesWritten)}
              </span>
            }
          />
        )}
      </Section>

      <Section title="Shortcuts">
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">{s.label}</span>
              <Kbd>{s.keys}</Kbd>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-auto px-4 py-3 text-[11px] text-subtle">
        ADB {adb.available ? `${adb.version ?? ''} · ${adb.source}` : 'unavailable'}
      </div>
    </aside>
  )
}
