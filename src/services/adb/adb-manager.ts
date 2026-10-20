import { EventEmitter } from 'node:events'
import { AppError, toErrorInfo } from '@shared/errors'
import type { Settings } from '@shared/settings'
import type { AdbStatus } from '@shared/types'
import type { ProcessRegistry } from '../process/process-registry'
import { AdbClient } from './adb-client'
import { locateAdb, type LocatorEnv } from './adb-locator'

export interface AdbManagerDeps {
  registry: ProcessRegistry
  locatorEnv: LocatorEnv
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  /** Injectable for tests. */
  createClient?: (path: string) => AdbClient
  isServerRunning?: () => Promise<boolean>
}

/** Chooses the adb executable, starts the adb server when needed and remembers whether we own it. */
export class AdbManager extends EventEmitter<{ status: [AdbStatus] }> {
  private client: AdbClient | null = null
  private ownsServer = false
  status: AdbStatus = { available: false }

  constructor(private readonly deps: AdbManagerDeps) {
    super()
  }

  async init(pref: Settings['adb']): Promise<AdbStatus> {
    const candidates = locateAdb(pref, this.deps.locatorEnv)
    const create = this.deps.createClient ?? ((p: string) => new AdbClient(p, this.deps.registry))
    this.client = null

    for (const candidate of candidates) {
      const client = create(candidate.path)
      try {
        const version = await client.version()
        this.client = client
        this.status = { available: true, path: candidate.path, source: candidate.source, version }
        this.deps.log('info', `Using adb ${version ?? '?'} (${candidate.source}) at ${candidate.path}`)
        break
      } catch (err) {
        this.deps.log('warn', `adb candidate failed: ${candidate.path}: ${(err as Error).message}`)
      }
    }

    if (!this.client) {
      this.status = { available: false, error: new AppError('ADB_NOT_FOUND').toInfo() }
      this.emit('status', this.status)
      return this.status
    }

    try {
      const running = await (this.deps.isServerRunning ?? (() => AdbClient.isServerRunning()))()
      if (!running) {
        await this.client.startServer()
        this.ownsServer = true
        this.deps.log('info', 'Started the adb server')
      }
    } catch (err) {
      this.status = { ...this.status, available: false, error: toErrorInfo(err) }
    }
    this.emit('status', this.status)
    return this.status
  }

  get(): AdbClient | null {
    return this.status.available ? this.client : null
  }

  require(): AdbClient {
    const client = this.get()
    if (!client) throw new AppError('ADB_NOT_FOUND', { detail: this.status.error?.detail })
    return client
  }

  get startedServer(): boolean {
    return this.ownsServer
  }

  /** Stop the adb server on exit, but only if FrameCast started it. */
  async shutdown(stopServer: boolean): Promise<void> {
    if (stopServer && this.ownsServer && this.client) {
      try {
        await this.client.killServer()
        this.deps.log('info', 'Stopped the adb server started by FrameCast')
      } catch (err) {
        this.deps.log('warn', `adb kill-server failed: ${(err as Error).message}`)
      }
    }
  }
}
