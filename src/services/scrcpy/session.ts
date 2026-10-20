import { EventEmitter } from 'node:events'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { AppError, classifyServerOutput } from '@shared/errors'
import type { AdbClient } from '../adb/adb-client'
import type { ManagedProcess, ProcessRegistry } from '../process/process-registry'
import { DeviceMessageParser, VideoStreamDemuxer, type DeviceMessage, type VideoStreamEvent } from './demuxer'
import { SERVER_DEVICE_PATH } from './protocol'
import { assertSafeServerArgs, buildServerArgs, randomScid, socketName, type ServerLaunchOptions } from './server-args'

export interface SessionOptions {
  serial: string
  serverJarPath: string
  launch: Omit<ServerLaunchOptions, 'scid' | 'tunnelForward'>
  connectTimeoutMs?: number
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface SessionEvents {
  video: [VideoStreamEvent]
  deviceMessage: [DeviceMessage]
  /** Emitted once when the session ends for any reason other than `stop()`. */
  closed: [AppError | null]
}

type Tunnel = { kind: 'reverse'; name: string; server: Server } | { kind: 'forward'; name: string; port: number }

/**
 * One mirroring session against scrcpy-server on a device:
 * push → tunnel → launch server → open video + control sockets → stream.
 */
export class ScrcpySession extends EventEmitter<SessionEvents> {
  private process: ManagedProcess | null = null
  private videoSocket: Socket | null = null
  private controlSocket: Socket | null = null
  private tunnel: Tunnel | null = null
  private stopping = false
  private closedEmitted = false
  private readonly serverLog: string[] = []
  deviceName = ''

  constructor(
    private readonly adb: AdbClient,
    private readonly registry: ProcessRegistry,
    private readonly opts: SessionOptions
  ) {
    super()
  }

  get serial(): string {
    return this.opts.serial
  }

  /** Resolves once the video stream has started (device name received). */
  async start(onStep: (step: string) => void): Promise<void> {
    const { serial } = this.opts
    const scid = randomScid()
    const name = socketName(scid)

    onStep('Installing mirroring server')
    await this.adb.push(serial, this.opts.serverJarPath, SERVER_DEVICE_PATH)

    onStep('Opening tunnel')
    let reverseServer: Server | null = null
    try {
      reverseServer = await listenLocal()
      await this.adb.reverse(serial, name, (reverseServer.address() as { port: number }).port)
      this.tunnel = { kind: 'reverse', name, server: reverseServer }
    } catch (err) {
      reverseServer?.close()
      this.opts.log('warn', `adb reverse failed, falling back to adb forward: ${(err as Error).message}`)
      const port = await this.adb.forward(serial, name)
      this.tunnel = { kind: 'forward', name, port }
    }
    const tunnelForward = this.tunnel.kind === 'forward'

    onStep('Starting mirroring server')
    const args = buildServerArgs({ ...this.opts.launch, scid, tunnelForward })
    assertSafeServerArgs(args)
    const proc = this.adb.spawnShell(serial, args, `scrcpy-server ${serial}`)
    this.process = proc
    this.captureServerOutput(proc)

    const exitedEarly = proc.exited.then(() => {
      throw new AppError(classifyServerOutput(this.serverLog.join('\n')) ?? 'SERVER_START_FAILED', {
        detail: this.serverTail() || 'The server process exited before connecting.'
      })
    })
    exitedEarly.catch(() => undefined) // only observed through the race below

    onStep('Connecting')
    const timeout = this.opts.connectTimeoutMs ?? 15_000
    try {
      const sockets = await Promise.race([
        this.tunnel.kind === 'reverse'
          ? acceptSockets(this.tunnel.server, 2, timeout)
          : connectForward(this.tunnel.port, timeout),
        exitedEarly
      ])
      ;[this.videoSocket, this.controlSocket] = sockets
    } catch (err) {
      await this.stop()
      if (err instanceof AppError) throw err
      throw new AppError('SERVER_CONNECT_FAILED', { detail: `${(err as Error).message}\n${this.serverTail()}`, cause: err })
    }
    // The server is connected; the tunnel is no longer needed.
    await this.removeTunnel()

    proc.exited.then(() => this.handleClosed('server process exited'))
    await this.wireSockets(tunnelForward)
  }

  private captureServerOutput(proc: ManagedProcess): void {
    const onLine = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.serverLog.push(trimmed)
        if (this.serverLog.length > 200) this.serverLog.shift()
        this.opts.log(/ERROR|Exception/.test(trimmed) ? 'error' : 'info', `[server] ${trimmed}`)
      }
    }
    proc.child.stdout?.on('data', onLine)
    proc.child.stderr?.on('data', onLine)
  }

  private serverTail(lines = 15): string {
    return this.serverLog.slice(-lines).join('\n')
  }

  private wireSockets(tunnelForward: boolean): Promise<void> {
    const video = this.videoSocket!
    const control = this.controlSocket!
    video.setNoDelay(true)
    control.setNoDelay(true)

    const demuxer = new VideoStreamDemuxer({ expectDummyByte: tunnelForward, expectDeviceMeta: true })
    const deviceParser = new DeviceMessageParser()

    return new Promise<void>((resolve, reject) => {
      let started = false
      video.on('data', (chunk: Buffer) => {
        let events: VideoStreamEvent[]
        try {
          events = demuxer.push(chunk)
        } catch (err) {
          this.handleClosed(`video stream corrupted: ${(err as Error).message}`)
          return
        }
        for (const ev of events) {
          if (ev.type === 'deviceMeta') {
            this.deviceName = ev.deviceName
            if (!started) {
              started = true
              resolve()
            }
          } else if (ev.type === 'disabled') {
            const error = new AppError(ev.error ? 'ENCODER_FAILED' : 'SERVER_START_FAILED', {
              detail: this.serverTail()
            })
            if (!started) reject(error)
            this.handleClosed('video disabled', error)
          }
          this.emit('video', ev)
        }
      })
      control.on('data', (chunk: Buffer) => {
        try {
          for (const msg of deviceParser.push(chunk)) this.emit('deviceMessage', msg)
        } catch (err) {
          this.opts.log('warn', `Ignoring control socket data: ${(err as Error).message}`)
        }
      })
      const onClose = (): void => {
        if (!started) reject(new AppError('SERVER_CONNECT_FAILED', { detail: this.serverTail() }))
        this.handleClosed('socket closed')
      }
      video.once('close', onClose)
      control.once('close', onClose)
      video.on('error', (e) => this.opts.log('warn', `video socket: ${e.message}`))
      control.on('error', (e) => this.opts.log('warn', `control socket: ${e.message}`))
      // Sockets were paused on accept so no bytes arrive before these handlers exist.
      video.resume()
      control.resume()
    })
  }

  private handleClosed(reason: string, error?: AppError): void {
    if (this.stopping || this.closedEmitted) return
    this.closedEmitted = true
    this.opts.log('warn', `Session ended: ${reason}`)
    const classified = classifyServerOutput(this.serverTail())
    const err =
      error ?? (classified ? new AppError(classified, { detail: this.serverTail() }) : new AppError('DEVICE_DISCONNECTED', { detail: reason }))
    void this.stop().finally(() => this.emit('closed', err))
  }

  sendControl(data: Buffer): boolean {
    const socket = this.controlSocket
    if (!socket || socket.destroyed || !socket.writable) return false
    socket.write(data)
    return true
  }

  private async removeTunnel(): Promise<void> {
    const tunnel = this.tunnel
    this.tunnel = null
    if (!tunnel) return
    try {
      if (tunnel.kind === 'reverse') {
        tunnel.server.close()
        await this.adb.reverseRemove(this.opts.serial, tunnel.name)
      } else {
        await this.adb.forwardRemove(this.opts.serial, tunnel.port)
      }
    } catch (err) {
      // The device may already be gone; nothing else to clean up.
      this.opts.log('warn', `Could not remove adb tunnel: ${(err as Error).message}`)
    }
  }

  /** Idempotent teardown: sockets, server process, tunnel. */
  async stop(): Promise<void> {
    this.stopping = true
    this.videoSocket?.destroy()
    this.controlSocket?.destroy()
    this.videoSocket = null
    this.controlSocket = null
    const proc = this.process
    this.process = null
    // Closing the sockets makes the server exit on its own (cleanup=true restores device settings);
    // give it a moment, then kill the local adb shell process.
    if (proc) {
      const exited = await Promise.race([proc.exited.then(() => true), delay(1500).then(() => false)])
      if (!exited) await this.registry.kill(proc)
    }
    await this.removeTunnel()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function listenLocal(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/** Accept `count` connections in order (the device connects video first, then control). Sockets are returned paused. */
export function acceptSockets(server: Server, count: number, timeoutMs: number): Promise<Socket[]> {
  return new Promise((resolve, reject) => {
    const sockets: Socket[] = []
    const timer = setTimeout(() => {
      server.off('connection', onConnection)
      for (const s of sockets) s.destroy()
      reject(new Error(`Timed out waiting for the device to connect (${sockets.length}/${count})`))
    }, timeoutMs)
    const onConnection = (socket: Socket): void => {
      // Paused until the session attaches its handlers, so no early bytes are lost.
      socket.pause()
      sockets.push(socket)
      if (sockets.length === count) {
        clearTimeout(timer)
        server.off('connection', onConnection)
        resolve(sockets)
      }
    }
    server.on('connection', onConnection)
  })
}

function connectOnce(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve(socket)
    })
    socket.once('error', reject)
  })
}

/**
 * Forward tunnel: adb accepts the TCP connection even when nothing listens on the device,
 * so wait for the server's dummy byte before considering the video socket connected.
 */
async function connectForward(port: number, timeoutMs: number): Promise<Socket[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let socket: Socket
    try {
      socket = await connectOnce(port)
    } catch {
      await delay(100)
      continue
    }
    const firstByte = await new Promise<Buffer | null>((resolve) => {
      socket.once('data', (d: Buffer) => {
        socket.pause()
        resolve(d)
      })
      socket.once('close', () => resolve(null))
      socket.once('error', () => resolve(null))
    })
    if (!firstByte) {
      socket.destroy()
      await delay(100)
      continue
    }
    socket.pause()
    // Re-inject the bytes already read so the demuxer still sees the dummy byte.
    socket.unshift(firstByte)
    const control = await connectOnce(port)
    control.pause()
    return [socket, control]
  }
  throw new Error('Timed out connecting to the device through adb forward')
}
