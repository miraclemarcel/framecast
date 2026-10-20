import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { applySettingsPatch, DEFAULT_SETTINGS, parseStoredSettings, type Settings, type SettingsPatch } from '@shared/settings'

/** Settings persisted as JSON in the user data directory. Writes are atomic (temp file + rename). */
export class SettingsStore extends EventEmitter<{ changed: [Settings] }> {
  private current: Settings

  constructor(private readonly filePath: string) {
    super()
    this.current = this.load()
  }

  private load(): Settings {
    try {
      return parseStoredSettings(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  get(): Settings {
    return this.current
  }

  /** Validates the merged result; throws (and keeps the old settings) when invalid. */
  update(patch: SettingsPatch): Settings {
    const next = applySettingsPatch(this.current, patch)
    this.persist(next)
    return next
  }

  reset(): Settings {
    this.persist(DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }

  private persist(next: Settings): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
    this.current = next
    this.emit('changed', next)
  }
}
