import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'node:child_process'

export interface ManagedProcess {
  readonly child: ChildProcess
  readonly label: string
  /** Resolves when the process has exited (or failed to spawn). */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

/**
 * Tracks every long-running child process FrameCast starts (adb shell for the
 * mirroring server, etc.) so they can all be terminated on shutdown and none are
 * left orphaned.
 */
export class ProcessRegistry {
  private readonly processes = new Set<ManagedProcess>()
  private readonly platform: NodeJS.Platform

  constructor(platform: NodeJS.Platform = process.platform) {
    this.platform = platform
  }

  get size(): number {
    return this.processes.size
  }

  spawn(command: string, args: readonly string[], label: string, options: SpawnOptions = {}): ManagedProcess {
    // shell is never enabled: arguments are passed as an array, not concatenated.
    const child = spawn(command, args, { windowsHide: true, ...options, shell: false })
    let resolveExit!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => (resolveExit = r))
    const managed: ManagedProcess = { child, label, exited }
    this.processes.add(managed)

    let settled = false
    const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      this.processes.delete(managed)
      resolveExit({ code, signal })
    }
    child.once('exit', settle)
    child.once('error', () => settle(null, null))
    return managed
  }

  /** Terminate one process (and its child tree on Windows) and wait for it to exit. */
  async kill(managed: ManagedProcess, timeoutMs = 3000): Promise<void> {
    const { child } = managed
    if (child.exitCode !== null || child.signalCode !== null || !this.processes.has(managed)) return
    if (this.platform === 'win32' && child.pid !== undefined) {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve())
      })
    } else {
      child.kill('SIGTERM')
    }
    const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs).unref())
    if ((await Promise.race([managed.exited, timer])) === 'timeout') {
      child.kill('SIGKILL')
      await Promise.race([managed.exited, new Promise((r) => setTimeout(r, 1000).unref())])
    }
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.processes].map((p) => this.kill(p)))
  }

  /** Synchronous last-resort cleanup for `process.on('exit')`. */
  killAllSync(): void {
    for (const { child } of this.processes) {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
    this.processes.clear()
  }
}
