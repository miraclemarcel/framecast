import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_SETTINGS, parseStoredSettings } from '@shared/settings'
import { SettingsStore } from '../src/main/settings-store'

const dirs: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'framecast-settings-'))
  dirs.push(dir)
  return join(dir, 'settings.json')
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('settings schema', () => {
  it('has complete defaults', () => {
    expect(DEFAULT_SETTINGS.frame.profile).toBe('contour')
    expect(DEFAULT_SETTINGS.video.bitRate).toBe(8_000_000)
    expect(DEFAULT_SETTINGS.connection.autoReconnect).toBe(true)
    expect(DEFAULT_SETTINGS.adb.source).toBe('auto')
  })

  it('merges nested patches without dropping sibling fields', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { video: { maxSize: 1024 } })
    expect(next.video).toEqual({ ...DEFAULT_SETTINGS.video, maxSize: 1024 })
    expect(next.frame).toEqual(DEFAULT_SETTINGS.frame)
  })

  it('rejects invalid values', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { video: { bitRate: 10 } })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { frame: { profile: 'iphone' as never } })).toThrow()
  })

  it('recovers per-section from a partially corrupt file', () => {
    const parsed = parseStoredSettings({ frame: { profile: 'edge' }, video: { bitRate: 'lots' }, theme: 'light' })
    expect(parsed.frame.profile).toBe('edge')
    expect(parsed.video).toEqual(DEFAULT_SETTINGS.video)
    expect(parsed.theme).toBe('light')
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('SettingsStore persistence', () => {
  it('persists updates and reloads them', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    store.update({ frame: { finish: 'titanium' }, theme: 'light' })
    const reloaded = new SettingsStore(file)
    expect(reloaded.get().frame.finish).toBe('titanium')
    expect(reloaded.get().theme).toBe('light')
    expect(JSON.parse(readFileSync(file, 'utf8')).frame.finish).toBe('titanium')
  })

  it('emits change events and keeps old settings on invalid updates', () => {
    const store = new SettingsStore(tempFile())
    let events = 0
    store.on('changed', () => events++)
    store.update({ display: { showInfoPanel: false } })
    expect(events).toBe(1)
    expect(() => store.update({ video: { maxFps: 999 } })).toThrow()
    expect(store.get().video.maxFps).toBe(DEFAULT_SETTINGS.video.maxFps)
    expect(events).toBe(1)
  })

  it('falls back to defaults for unreadable JSON', () => {
    const file = tempFile()
    writeFileSync(file, '{ not json')
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('reset restores defaults', () => {
    const store = new SettingsStore(tempFile())
    store.update({ theme: 'light' })
    expect(store.reset()).toEqual(DEFAULT_SETTINGS)
  })
})
