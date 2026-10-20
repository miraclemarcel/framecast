import {
  DEVICE_NAME_FIELD_LENGTH,
  DeviceMessageType,
  PACKET_FLAG_CONFIG,
  PACKET_FLAG_KEY_FRAME,
  PACKET_FLAG_SESSION,
  PACKET_HEADER_LENGTH,
  PACKET_PTS_MASK
} from './protocol'

/** Accumulates socket chunks and hands out exact-length reads without re-concatenating everything. */
export class ByteQueue {
  private chunks: Buffer[] = []
  private offset = 0 // read offset into chunks[0]
  length = 0

  push(chunk: Buffer): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  /** Remove and return exactly `n` bytes. Caller must check `length >= n`. */
  take(n: number): Buffer {
    if (n > this.length) throw new RangeError(`take(${n}) with only ${this.length} buffered`)
    this.length -= n
    const first = this.chunks[0]
    if (first && first.length - this.offset >= n) {
      const out = first.subarray(this.offset, this.offset + n)
      this.offset += n
      if (this.offset === first.length) {
        this.chunks.shift()
        this.offset = 0
      }
      return out
    }
    const out = Buffer.allocUnsafe(n)
    let written = 0
    while (written < n) {
      const chunk = this.chunks[0]
      const available = chunk.length - this.offset
      const count = Math.min(available, n - written)
      chunk.copy(out, written, this.offset, this.offset + count)
      written += count
      this.offset += count
      if (this.offset === chunk.length) {
        this.chunks.shift()
        this.offset = 0
      }
    }
    return out
  }

  peekByte(): number {
    return this.chunks[0][this.offset]
  }

  /** Return the next `n` bytes without consuming them. */
  peek(n: number): Buffer {
    if (n > this.length) throw new RangeError(`peek(${n}) with only ${this.length} buffered`)
    const out = Buffer.allocUnsafe(n)
    let written = 0
    let offset = this.offset
    for (const chunk of this.chunks) {
      const count = Math.min(chunk.length - offset, n - written)
      chunk.copy(out, written, offset, offset + count)
      written += count
      offset = 0
      if (written === n) break
    }
    return out
  }
}

export type VideoStreamEvent =
  | { type: 'deviceMeta'; deviceName: string }
  | { type: 'codec'; codecId: number }
  | { type: 'disabled'; error: boolean }
  | { type: 'session'; width: number; height: number; clientResize: boolean }
  | { type: 'packet'; config: boolean; key: boolean; pts: number; data: Buffer }

type Stage = 'dummy' | 'meta' | 'codec' | 'header' | 'payload' | 'done'

export interface VideoDemuxerOptions {
  /** A dummy byte is sent on the first socket for forward tunnels. */
  expectDummyByte: boolean
  /** Device meta (64-byte name) is sent on the first socket (the video socket here). */
  expectDeviceMeta: boolean
  /** Upper bound to protect against a corrupted stream. */
  maxPacketSize?: number
}

/**
 * Incremental parser for the scrcpy v5 video socket:
 *   [dummy byte] [device name: 64] codec id: u32, then a sequence of
 *   session packets (12 bytes, MSB set) and media packets (12-byte header + payload).
 */
export class VideoStreamDemuxer {
  private readonly queue = new ByteQueue()
  private stage: Stage
  private pending: { config: boolean; key: boolean; pts: number; size: number } | null = null
  private readonly maxPacketSize: number
  private readonly expectDeviceMeta: boolean

  constructor(opts: VideoDemuxerOptions) {
    this.expectDeviceMeta = opts.expectDeviceMeta
    this.stage = opts.expectDummyByte ? 'dummy' : opts.expectDeviceMeta ? 'meta' : 'codec'
    this.maxPacketSize = opts.maxPacketSize ?? 64 * 1024 * 1024
  }

  /** Feed bytes; returns the events fully decoded from the data so far. */
  push(chunk: Buffer): VideoStreamEvent[] {
    this.queue.push(chunk)
    const events: VideoStreamEvent[] = []
    for (;;) {
      switch (this.stage) {
        case 'dummy':
          if (this.queue.length < 1) return events
          this.queue.take(1)
          this.stage = this.expectDeviceMeta ? 'meta' : 'codec'
          break
        case 'meta': {
          if (this.queue.length < DEVICE_NAME_FIELD_LENGTH) return events
          const raw = this.queue.take(DEVICE_NAME_FIELD_LENGTH)
          const nul = raw.indexOf(0)
          events.push({ type: 'deviceMeta', deviceName: raw.subarray(0, nul < 0 ? raw.length : nul).toString('utf8') })
          this.stage = 'codec'
          break
        }
        case 'codec': {
          if (this.queue.length < 4) return events
          const codecId = this.queue.take(4).readUInt32BE(0)
          if (codecId === 0 || codecId === 1) {
            // 0: stream explicitly disabled, 1: configuration error on the device.
            events.push({ type: 'disabled', error: codecId === 1 })
            this.stage = 'done'
            return events
          }
          events.push({ type: 'codec', codecId })
          this.stage = 'header'
          break
        }
        case 'header': {
          if (this.queue.length < PACKET_HEADER_LENGTH) return events
          const header = this.queue.take(PACKET_HEADER_LENGTH)
          const first = header.readBigUInt64BE(0)
          if (first & PACKET_FLAG_SESSION) {
            events.push({
              type: 'session',
              clientResize: (header[3] & 1) === 1,
              width: header.readUInt32BE(4),
              height: header.readUInt32BE(8)
            })
            break
          }
          const size = header.readUInt32BE(8)
          if (size > this.maxPacketSize) throw new Error(`Invalid video packet size ${size}`)
          const config = (first & PACKET_FLAG_CONFIG) !== 0n
          this.pending = {
            config,
            key: !config && (first & PACKET_FLAG_KEY_FRAME) !== 0n,
            pts: config ? 0 : Number(first & PACKET_PTS_MASK),
            size
          }
          this.stage = 'payload'
          break
        }
        case 'payload': {
          const p = this.pending!
          if (this.queue.length < p.size) return events
          // Copy so the event owns its bytes independently of socket buffers.
          const data = Buffer.from(this.queue.take(p.size))
          events.push({ type: 'packet', config: p.config, key: p.key, pts: p.pts, data })
          this.pending = null
          this.stage = 'header'
          break
        }
        case 'done':
          return events
      }
    }
  }
}

export type DeviceMessage =
  | { type: 'clipboard'; text: string }
  | { type: 'ackClipboard'; sequence: bigint }
  | { type: 'uhidOutput'; id: number; data: Buffer }

/** Incremental parser for device → client messages on the control socket. */
export class DeviceMessageParser {
  private readonly queue = new ByteQueue()

  push(chunk: Buffer): DeviceMessage[] {
    this.queue.push(chunk)
    const out: DeviceMessage[] = []
    for (;;) {
      const msg = this.tryParse()
      if (!msg) return out
      out.push(msg)
    }
  }

  private tryParse(): DeviceMessage | null {
    if (this.queue.length < 1) return null
    const type = this.queue.peekByte()
    switch (type) {
      case DeviceMessageType.CLIPBOARD: {
        if (this.queue.length < 5) return null
        const header = this.queue.peek(5)
        const len = header.readUInt32BE(1)
        if (this.queue.length < 5 + len) return null
        this.queue.take(5)
        return { type: 'clipboard', text: this.queue.take(len).toString('utf8') }
      }
      case DeviceMessageType.ACK_CLIPBOARD: {
        if (this.queue.length < 9) return null
        const buf = this.queue.take(9)
        return { type: 'ackClipboard', sequence: buf.readBigUInt64BE(1) }
      }
      case DeviceMessageType.UHID_OUTPUT: {
        if (this.queue.length < 5) return null
        const header = this.queue.peek(5)
        const len = header.readUInt16BE(3)
        if (this.queue.length < 5 + len) return null
        this.queue.take(5)
        return { type: 'uhidOutput', id: header.readUInt16BE(1), data: Buffer.from(this.queue.take(len)) }
      }
      default:
        throw new Error(`Unknown device message type ${type}`)
    }
  }
}
