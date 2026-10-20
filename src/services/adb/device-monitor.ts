import { EventEmitter } from 'node:events'
import { AppError } from '@shared/errors'
import type { AdbDeviceEntry, DeviceDetails, DeviceInfo } from '@shared/types'

export interface DeviceSource {
  devices(): Promise<AdbDeviceEntry[]>
  details(serial: string): Promise<DeviceDetails>
}

export interface DeviceMonitorEvents {
  changed: [DeviceInfo[]]
  error: [AppError]
  /** A device became usable (`device` state). */
  ready: [DeviceInfo]
  /** A device that was usable is gone or no longer in `device` state. */
  lost: [string]
}

function detailsKey(d: AdbDeviceEntry): string {
  return `${d.serial}|${d.transportId ?? ''}`
}

/** Polls `adb devices -l` and enriches authorized devices with model/version/screen details. */
export class DeviceMonitor extends EventEmitter<DeviceMonitorEvents> {
  private timer: NodeJS.Timeout | null = null
  private list: DeviceInfo[] = []
  private readonly detailsCache = new Map<string, DeviceDetails>()
  private readonly pendingDetails = new Set<string>()
  private polling: Promise<DeviceInfo[]> | null = null
  private lastErrorCode: string | null = null

  constructor(
    private readonly getSource: () => DeviceSource | null,
    private readonly intervalMs = 1500
  ) {
    super()
  }

  get devices(): DeviceInfo[] {
    return this.list
  }

  find(serial: string): DeviceInfo | undefined {
    return this.list.find((d) => d.serial === serial)
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Poll now. Concurrent calls share the same in-flight poll. */
  refresh(): Promise<DeviceInfo[]> {
    this.polling ??= this.poll().finally(() => (this.polling = null))
    return this.polling
  }

  private async poll(): Promise<DeviceInfo[]> {
    const source = this.getSource()
    if (!source) {
      this.apply([])
      return this.list
    }
    let entries: AdbDeviceEntry[]
    try {
      entries = await source.devices()
      this.lastErrorCode = null
    } catch (err) {
      const error = err instanceof AppError ? err : new AppError('ADB_FAILED', { detail: String(err) })
      // Report each distinct failure once instead of every poll.
      if (this.lastErrorCode !== error.code) this.emit('error', error)
      this.lastErrorCode = error.code
      this.apply([])
      return this.list
    }

    const live = new Set(entries.map(detailsKey))
    for (const key of this.detailsCache.keys()) if (!live.has(key)) this.detailsCache.delete(key)

    for (const entry of entries) {
      const key = detailsKey(entry)
      if (entry.state === 'device' && !this.detailsCache.has(key) && !this.pendingDetails.has(key)) {
        this.pendingDetails.add(key)
        source
          .details(entry.serial)
          .then((details) => {
            this.detailsCache.set(key, details)
            this.apply(this.rawEntries)
          })
          .catch(() => this.detailsCache.set(key, {}))
          .finally(() => this.pendingDetails.delete(key))
      }
    }
    this.apply(entries)
    return this.list
  }

  private rawEntries: AdbDeviceEntry[] = []

  private apply(entries: AdbDeviceEntry[]): void {
    this.rawEntries = entries
    const next: DeviceInfo[] = entries.map((e) => ({ ...e, details: this.detailsCache.get(detailsKey(e)) }))
    const before = this.list
    if (JSON.stringify(before) === JSON.stringify(next)) return
    this.list = next

    const wasReady = new Set(before.filter((d) => d.state === 'device').map((d) => d.serial))
    const isReady = new Set(next.filter((d) => d.state === 'device').map((d) => d.serial))
    for (const serial of wasReady) if (!isReady.has(serial)) this.emit('lost', serial)
    for (const d of next) if (d.state === 'device' && !wasReady.has(d.serial)) this.emit('ready', d)
    this.emit('changed', next)
  }
}
