import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { AppError, classifyAdbOutput } from '@shared/errors'
import type { AdbDeviceEntry, DeviceDetails } from '@shared/types'
import type { ManagedProcess, ProcessRegistry } from '../process/process-registry'
import { DETAILS_COMMAND, parseAdbDevices, parseAdbVersion, parseDeviceDetails, parseWlanIp } from './parse'

export interface ExecOptions {
  serial?: string
  timeoutMs?: number
  /** Return stdout as a Buffer (binary output such as screencap). */
  binary?: boolean
}

export interface ExecResult<T extends string | Buffer = string> {
  stdout: T
  stderr: string
}

export const ADB_SERVER_PORT = 5037

/**
 * Thin, safe wrapper around the adb executable. Every invocation uses
 * execFile/spawn with an argument array — never a shell string.
 */
export class AdbClient {
  constructor(
    readonly adbPath: string,
    private readonly registry: ProcessRegistry
  ) {}

  private withSerial(args: readonly string[], serial?: string): string[] {
    return serial ? ['-s', serial, ...args] : [...args]
  }

  exec(args: readonly string[], opts?: ExecOptions & { binary?: false }): Promise<ExecResult<string>>
  exec(args: readonly string[], opts: ExecOptions & { binary: true }): Promise<ExecResult<Buffer>>
  exec(args: readonly string[], opts: ExecOptions = {}): Promise<ExecResult<string | Buffer>> {
    const fullArgs = this.withSerial(args, opts.serial)
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        fullArgs,
        {
          windowsHide: true,
          timeout: opts.timeoutMs ?? 15_000,
          maxBuffer: 128 * 1024 * 1024,
          encoding: opts.binary ? 'buffer' : 'utf8'
        },
        (error, stdout, stderr) => {
          const stderrText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr
          if (error) {
            const text = `${stderrText}\n${Buffer.isBuffer(stdout) ? '' : stdout}\n${error.message}`
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT') {
              reject(new AppError('ADB_NOT_FOUND', { detail: this.adbPath, cause: error }))
              return
            }
            const classified = classifyAdbOutput(text)
            const timedOut = (error as { killed?: boolean }).killed === true
            reject(
              new AppError(classified ?? 'ADB_FAILED', {
                message: timedOut ? `adb ${args[0] ?? ''} timed out.` : undefined,
                detail: `adb ${fullArgs.join(' ')}: ${text.trim()}`.slice(0, 2000),
                cause: error
              })
            )
            return
          }
          resolve({ stdout, stderr: stderrText })
        }
      )
    })
  }

  async version(): Promise<string | undefined> {
    const { stdout } = await this.exec(['version'], { timeoutMs: 5000 })
    return parseAdbVersion(stdout)
  }

  /** True if something is listening on the adb server port. */
  static isServerRunning(port = ADB_SERVER_PORT, timeoutMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      const done = (v: boolean): void => {
        socket.destroy()
        resolve(v)
      }
      socket.setTimeout(timeoutMs, () => done(false))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })
  }

  async startServer(): Promise<void> {
    await this.exec(['start-server'], { timeoutMs: 20_000 })
  }

  async killServer(): Promise<void> {
    await this.exec(['kill-server'], { timeoutMs: 5000 })
  }

  async devices(): Promise<AdbDeviceEntry[]> {
    const { stdout } = await this.exec(['devices', '-l'], { timeoutMs: 10_000 })
    return parseAdbDevices(stdout)
  }

  async details(serial: string): Promise<DeviceDetails> {
    const { stdout } = await this.exec(['shell', DETAILS_COMMAND], { serial, timeoutMs: 10_000 })
    return parseDeviceDetails(stdout)
  }

  async push(serial: string, local: string, remote: string): Promise<void> {
    await this.exec(['push', local, remote], { serial, timeoutMs: 30_000 })
  }

  async reverse(serial: string, socketName: string, port: number): Promise<void> {
    await this.exec(['reverse', `localabstract:${socketName}`, `tcp:${port}`], { serial })
  }

  async reverseRemove(serial: string, socketName: string): Promise<void> {
    await this.exec(['reverse', '--remove', `localabstract:${socketName}`], { serial, timeoutMs: 5000 })
  }

  /** `adb forward tcp:0 ...` lets adb choose a free port and prints it. */
  async forward(serial: string, socketName: string): Promise<number> {
    const { stdout } = await this.exec(['forward', 'tcp:0', `localabstract:${socketName}`], { serial })
    const port = Number.parseInt(stdout.trim(), 10)
    if (!Number.isInteger(port) || port <= 0) throw new AppError('ADB_FAILED', { detail: `adb forward returned "${stdout}"` })
    return port
  }

  async forwardRemove(serial: string, port: number): Promise<void> {
    await this.exec(['forward', '--remove', `tcp:${port}`], { serial, timeoutMs: 5000 })
  }

  /** Start a long-running `adb shell` process, tracked by the registry. */
  spawnShell(serial: string, args: readonly string[], label: string): ManagedProcess {
    return this.registry.spawn(this.adbPath, this.withSerial(['shell', ...args], serial), label, {
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }

  /** Full-resolution PNG of the current screen. */
  async screencap(serial: string): Promise<Buffer> {
    const { stdout } = await this.exec(['exec-out', 'screencap', '-p'], { serial, binary: true, timeoutMs: 20_000 })
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    if (stdout.length < 8 || !stdout.subarray(0, 4).equals(PNG_MAGIC)) {
      throw new AppError('SCREENSHOT_FAILED', { detail: 'screencap did not return a PNG image' })
    }
    return stdout
  }

  async tcpip(serial: string, port: number): Promise<string> {
    const { stdout } = await this.exec(['tcpip', String(port)], { serial, timeoutMs: 15_000 })
    return stdout.trim()
  }

  async wlanIp(serial: string): Promise<string | undefined> {
    const { stdout } = await this.exec(['shell', 'ip -f inet addr show wlan0'], { serial, timeoutMs: 5000 })
    return parseWlanIp(stdout)
  }

  /** adb connect exits 0 even on failure, so the output must be inspected. */
  async connect(host: string, port: number): Promise<string> {
    const target = `${host}:${port}`
    const { stdout } = await this.exec(['connect', target], { timeoutMs: 20_000 })
    const text = stdout.trim()
    if (!/^(connected to|already connected to)/i.test(text)) {
      throw new AppError('WIRELESS_FAILED', { detail: text || `adb connect ${target} failed` })
    }
    return target
  }

  async pair(host: string, port: number, code: string): Promise<string> {
    const { stdout } = await this.exec(['pair', `${host}:${port}`, code], { timeoutMs: 30_000 })
    const text = stdout.trim()
    if (!/successfully paired/i.test(text)) throw new AppError('PAIRING_FAILED', { detail: text })
    return text
  }

  async disconnect(serial: string): Promise<void> {
    await this.exec(['disconnect', serial], { timeoutMs: 10_000 })
  }
}
