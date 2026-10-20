import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProcessRegistry } from '@services/process/process-registry'
import { ScrcpySession } from '@services/scrcpy/session'
import { serializeControlMessage } from '@services/scrcpy/control'
import type { VideoStreamEvent, DeviceMessage } from '@services/scrcpy/demuxer'
import type { AdbClient } from '@services/adb/adb-client'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { AppError } from '@shared/errors'

const FAKE_SERVER = join(__dirname, 'fixtures', 'fake-scrcpy-server.mjs')

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

/** Fake adb: tunnels are local TCP ports; "adb shell" runs the fake device server with node. */
function fakeAdb(registry: ProcessRegistry, mode: 'reverse' | 'forward', behaviour = '') {
  const calls: string[] = []
  let port = 0
  const adb = {
    push: async () => void calls.push('push'),
    reverse: async (_s: string, _n: string, p: number) => {
      calls.push('reverse')
      if (mode === 'forward') throw new Error('reverse unsupported')
      port = p
    },
    reverseRemove: async () => void calls.push('reverseRemove'),
    forward: async () => {
      calls.push('forward')
      port = await freePort()
      return port
    },
    forwardRemove: async () => void calls.push('forwardRemove'),
    spawnShell: (_serial: string, args: readonly string[], label: string) => {
      calls.push(`shell ${args.slice(4, 5).join(' ')}`)
      return registry.spawn(process.execPath, [FAKE_SERVER, mode, String(port), behaviour], label, {
        stdio: ['ignore', 'pipe', 'pipe']
      })
    }
  }
  return { adb: adb as unknown as AdbClient, calls }
}

function makeSession(adb: AdbClient, registry: ProcessRegistry): ScrcpySession {
  return new ScrcpySession(adb, registry, {
    serial: 'FAKE',
    serverJarPath: 'unused',
    launch: { video: DEFAULT_SETTINGS.video, control: DEFAULT_SETTINGS.control },
    connectTimeoutMs: 8000,
    log: () => undefined
  })
}

async function exercise(mode: 'reverse' | 'forward'): Promise<void> {
  const registry = new ProcessRegistry()
  const { adb, calls } = fakeAdb(registry, mode)
  const session = makeSession(adb, registry)
  const videoEvents: VideoStreamEvent[] = []
  const deviceMessages: DeviceMessage[] = []
  session.on('video', (e) => videoEvents.push(e))
  session.on('deviceMessage', (m) => deviceMessages.push(m))

  const steps: string[] = []
  await session.start((s) => steps.push(s))
  expect(session.deviceName).toBe('Fake Phone')
  expect(steps).toEqual(['Installing mirroring server', 'Opening tunnel', 'Starting mirroring server', 'Connecting'])
  expect(calls).toContain('shell 5.0.1')
  expect(calls).toContain(mode === 'reverse' ? 'reverseRemove' : 'forwardRemove')

  await waitFor(() => videoEvents.some((e) => e.type === 'packet' && e.key))
  expect(videoEvents.find((e) => e.type === 'session')).toEqual({ type: 'session', width: 1080, height: 2400, clientResize: false })
  expect(videoEvents.filter((e) => e.type === 'packet').map((e) => (e as { config: boolean }).config)).toEqual([true, false])

  // Control path round trip: the fake server echoes control bytes back as a clipboard message.
  session.sendControl(serializeControlMessage({ type: 'rotateDevice' }))
  await waitFor(() => deviceMessages.length > 0)
  expect(deviceMessages[0]).toEqual({ type: 'clipboard', text: '0b' })

  await session.stop()
  await waitFor(() => registry.size === 0)
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('ScrcpySession against a fake device server', () => {
  it('streams video and exchanges control messages over a reverse tunnel', () => exercise('reverse'), 15000)

  it('falls back to a forward tunnel (with dummy byte)', () => exercise('forward'), 15000)

  it('reports the session as closed when the server dies', async () => {
    const registry = new ProcessRegistry()
    const { adb } = fakeAdb(registry, 'reverse', 'crash')
    const session = makeSession(adb, registry)
    const closed = new Promise<AppError | null>((resolve) => session.on('closed', resolve))
    await session.start(() => undefined)
    const err = await closed
    expect(err).toBeInstanceOf(AppError)
    expect(err?.code).toBe('DEVICE_DISCONNECTED')
    await waitFor(() => registry.size === 0)
  }, 15000)

  it('fails to start with a helpful error when the server exits immediately', async () => {
    const registry = new ProcessRegistry()
    const { adb } = fakeAdb(registry, 'reverse')
    ;(adb as unknown as { spawnShell: unknown }).spawnShell = (_s: string, _a: string[], label: string) =>
      registry.spawn(
        process.execPath,
        ['-e', 'console.error("ERROR: The server version (4.0) does not match the client (5.0.1)"); process.exit(1)'],
        label,
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
    const session = makeSession(adb, registry)
    await expect(session.start(() => undefined)).rejects.toMatchObject({ code: 'SERVER_START_FAILED' })
    expect(registry.size).toBe(0)
  }, 15000)
})
