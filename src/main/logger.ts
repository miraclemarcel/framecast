import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 5 * 1024 * 1024

/**
 * Diagnostic log. It records lifecycle events, commands and errors only —
 * never screen content, clipboard text or typed input.
 */
export class Logger {
  private dirReady = false

  constructor(readonly filePath: string) {}

  get directory(): string {
    return dirname(this.filePath)
  }

  log(level: LogLevel, scope: string, message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}\n`
    if (level === 'error') console.error(line.trimEnd())
    else if (process.env.NODE_ENV === 'development') console.log(line.trimEnd())
    try {
      if (!this.dirReady) {
        mkdirSync(this.directory, { recursive: true })
        this.dirReady = true
      }
      this.rotateIfNeeded()
      appendFileSync(this.filePath, line)
    } catch {
      // Logging must never break the app.
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.filePath).size > MAX_LOG_BYTES) renameSync(this.filePath, join(this.directory, 'framecast.old.log'))
    } catch {
      // file does not exist yet
    }
  }

  scope(scope: string): ScopedLogger {
    return {
      debug: (m) => this.log('debug', scope, m),
      info: (m) => this.log('info', scope, m),
      warn: (m) => this.log('warn', scope, m),
      error: (m) => this.log('error', scope, m)
    }
  }
}

export interface ScopedLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}
