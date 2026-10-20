import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProcessRegistry } from '@services/process/process-registry'
import { locateAdb } from '@services/adb/adb-locator'
import { assertSafeServerArgs, buildServerArgs, socketName } from '@services/scrcpy/server-args'
import { DEFAULT_SETTINGS } from '@shared/settings'

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleeper = ['-e', 'setInterval(() => {}, 1000)']

describe('ProcessRegistry', () => {
  it('tracks spawned processes and kills them all', async () => {
    const registry = new ProcessRegistry()
    const a = registry.spawn(process.execPath, sleeper, 'a')
    const b = registry.spawn(process.execPath, sleeper, 'b')
    await new Promise((r) => setTimeout(r, 200))
    expect(registry.size).toBe(2)
    expect(isAlive(a.child.pid!)).toBe(true)
    await registry.killAll()
    await Promise.all([a.exited, b.exited])
    expect(registry.size).toBe(0)
    expect(isAlive(a.child.pid!)).toBe(false)
    expect(isAlive(b.child.pid!)).toBe(false)
  })

  it('kills a process tree (child of child) on Windows', async () => {
    const registry = new ProcessRegistry()
    // Parent prints its child's pid, then idles.
    const script = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)`
    const parent = registry.spawn(process.execPath, ['-e', script], 'tree', { stdio: ['ignore', 'pipe', 'ignore'] })
    const grandchildPid = await new Promise<number>((resolve) =>
      parent.child.stdout!.once('data', (d: Buffer) => resolve(Number(d.toString().trim())))
    )
    expect(isAlive(grandchildPid)).toBe(true)
    await registry.killAll()
    await new Promise((r) => setTimeout(r, 300))
    expect(isAlive(parent.child.pid!)).toBe(false)
    if (process.platform === 'win32') expect(isAlive(grandchildPid)).toBe(false)
    else process.kill(grandchildPid)
  })

  it('removes processes that exit on their own', async () => {
    const registry = new ProcessRegistry()
    const p = registry.spawn(process.execPath, ['-e', 'process.exit(3)'], 'short')
    expect(await p.exited).toMatchObject({ code: 3 })
    expect(registry.size).toBe(0)
  })

  it('settles when the executable does not exist', async () => {
    const registry = new ProcessRegistry()
    const p = registry.spawn(join(__dirname, 'does-not-exist.exe'), [], 'missing')
    p.child.on('error', () => undefined)
    await p.exited
    expect(registry.size).toBe(0)
  })

  it('killAllSync clears the registry', () => {
    const registry = new ProcessRegistry()
    registry.spawn(process.execPath, sleeper, 'sync')
    registry.killAllSync()
    expect(registry.size).toBe(0)
  })
})

describe('adb locator', () => {
  const env = (existing: string[], extra: Record<string, string> = {}) => ({
    platform: 'win32' as NodeJS.Platform,
    env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: 'C:\\tools', ...extra },
    bundledDir: 'C:\\app\\resources\\bin\\platform-tools',
    exists: (p: string) => existing.includes(p)
  })
  const sdk = join('C:\\Users\\me\\AppData\\Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe')
  const bundled = join('C:\\app\\resources\\bin\\platform-tools', 'adb.exe')

  it('auto prefers an installed SDK over the bundled copy', () => {
    expect(locateAdb(DEFAULT_SETTINGS.adb, env([sdk, bundled])).map((c) => c.source)).toEqual(['system', 'bundled'])
  })
  it('auto falls back to bundled when no SDK exists', () => {
    expect(locateAdb(DEFAULT_SETTINGS.adb, env([bundled]))).toEqual([{ path: bundled, source: 'bundled' }])
  })
  it('respects explicit choices', () => {
    expect(locateAdb({ ...DEFAULT_SETTINGS.adb, source: 'bundled' }, env([sdk, bundled]))).toEqual([{ path: bundled, source: 'bundled' }])
    expect(locateAdb({ ...DEFAULT_SETTINGS.adb, source: 'custom', customPath: 'D:\\adb.exe' }, env(['D:\\adb.exe']))).toEqual([
      { path: 'D:\\adb.exe', source: 'custom' }
    ])
    expect(locateAdb({ ...DEFAULT_SETTINGS.adb, source: 'custom', customPath: '' }, env([sdk]))).toEqual([])
  })
  it('honours ANDROID_HOME', () => {
    const home = join('E:\\sdk', 'platform-tools', 'adb.exe')
    expect(locateAdb(DEFAULT_SETTINGS.adb, env([home], { ANDROID_HOME: 'E:\\sdk' }))[0]).toEqual({ path: home, source: 'system' })
  })
})

describe('server arguments', () => {
  const args = buildServerArgs({
    scid: 0x1a2b3c,
    tunnelForward: false,
    video: DEFAULT_SETTINGS.video,
    control: DEFAULT_SETTINGS.control
  })

  it('pins the server version and passes options as key=value pairs', () => {
    expect(args.slice(0, 5)).toEqual([
      'CLASSPATH=/data/local/tmp/framecast-server.jar',
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      '5.0.1'
    ])
    expect(args).toContain('scid=001a2b3c')
    expect(args).toContain('audio=false')
    expect(args).toContain('tunnel_forward=false')
    expect(args).toContain(`video_bit_rate=${DEFAULT_SETTINGS.video.bitRate}`)
    expect(args).toContain(`max_size=${DEFAULT_SETTINGS.video.maxSize}`)
    expect(() => assertSafeServerArgs(args)).not.toThrow()
  })

  it('omits max_size / max_fps when unlimited', () => {
    const unlimited = buildServerArgs({
      scid: 1,
      tunnelForward: true,
      video: { ...DEFAULT_SETTINGS.video, maxSize: 0, maxFps: 0 },
      control: DEFAULT_SETTINGS.control
    })
    expect(unlimited.some((a) => a.startsWith('max_size='))).toBe(false)
    expect(unlimited.some((a) => a.startsWith('max_fps='))).toBe(false)
  })

  it('rejects anything a shell could interpret', () => {
    expect(() => assertSafeServerArgs(['a;reboot'])).toThrow()
    expect(() => assertSafeServerArgs(['x=$(id)'])).toThrow()
    expect(() => assertSafeServerArgs(['scid=zz'])).toThrow()
  })

  it('formats socket names like the server', () => {
    expect(socketName(0x1a2b3c)).toBe('scrcpy_001a2b3c')
  })
})
