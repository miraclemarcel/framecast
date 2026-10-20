import { closeSync, openSync, writeSync } from 'node:fs'
import { Muxer, StreamTarget } from 'mp4-muxer'
import { annexBToAvcc, buildAvcC, parseConfigPacket, type H264Config } from '@shared/media/h264'
import type { Size } from '@shared/types'

export interface RecorderPacket {
  config: boolean
  key: boolean
  pts: number
  data: Uint8Array
}

interface Part {
  path: string
  fd: number
  muxer: Muxer<StreamTarget>
  size: Size
  config: H264Config
  bytes: number
  /** Packet held back until the next one arrives, to know its duration. */
  held: { data: Uint8Array; key: boolean; pts: number } | null
  firstChunk: boolean
  lastPts: number
}

const DEFAULT_FRAME_US = 16_667

function sameConfig(a: H264Config, b: H264Config): boolean {
  return Buffer.compare(Buffer.from(a.sps), Buffer.from(b.sps)) === 0 && Buffer.compare(Buffer.from(a.pps), Buffer.from(b.pps)) === 0
}

/**
 * Writes the device's H.264 stream into MP4 without re-encoding.
 * A new part file is started when the resolution or codec parameters change
 * (e.g. after a rotation), because one MP4 track cannot change dimensions.
 */
export class Mp4Recorder {
  private part: Part | null = null
  private readonly parts: string[] = []
  private config: H264Config | null = null
  private size: Size | null = null
  private bytesDone = 0
  private stopped = false

  constructor(private readonly pathForPart: (index: number) => string) {}

  /** Seed with the most recent stream state so recording can begin at the next key frame. */
  prime(configPacket: Uint8Array | null, size: Size | null): void {
    if (configPacket) this.config = parseConfigPacket(configPacket)
    this.size = size
  }

  get files(): string[] {
    return [...this.parts]
  }

  get bytesWritten(): number {
    return this.bytesDone + (this.part?.bytes ?? 0)
  }

  onSession(size: Size): void {
    if (this.part && (this.part.size.width !== size.width || this.part.size.height !== size.height)) this.finishPart()
    this.size = size
  }

  onPacket(pkt: RecorderPacket): void {
    if (this.stopped) return
    if (pkt.config) {
      const cfg = parseConfigPacket(pkt.data)
      if (!cfg) return
      if (this.part && !sameConfig(this.part.config, cfg)) this.finishPart()
      this.config = cfg
      return
    }
    if (!this.part) {
      // A new file must start with a key frame and known parameters.
      if (!pkt.key || !this.config || !this.size) return
      this.openPart(this.config, this.size)
    }
    this.writeFrame(this.part!, pkt)
  }

  private openPart(config: H264Config, size: Size): void {
    const path = this.pathForPart(this.parts.length + 1)
    const fd = openSync(path, 'w')
    const part: Part = {
      path,
      fd,
      size,
      config,
      bytes: 0,
      held: null,
      firstChunk: true,
      lastPts: -1,
      muxer: undefined as unknown as Muxer<StreamTarget>
    }
    part.muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => {
          writeSync(fd, data, 0, data.length, position)
          part.bytes = Math.max(part.bytes, position + data.length)
        }
      }),
      video: { codec: 'avc', width: size.width, height: size.height },
      fastStart: false,
      firstTimestampBehavior: 'offset'
    })
    this.parts.push(path)
    this.part = part
  }

  private writeFrame(part: Part, pkt: RecorderPacket): void {
    // Timestamps must strictly increase within a track.
    const pts = pkt.pts > part.lastPts ? pkt.pts : part.lastPts + 1
    part.lastPts = pts
    if (part.held) this.flushHeld(part, pts - part.held.pts)
    part.held = { data: annexBToAvcc(pkt.data), key: pkt.key, pts }
  }

  private flushHeld(part: Part, duration: number): void {
    const held = part.held!
    part.held = null
    if (held.data.length === 0) return
    const meta = part.firstChunk
      ? {
          decoderConfig: {
            codec: part.config.codec,
            codedWidth: part.size.width,
            codedHeight: part.size.height,
            description: buildAvcC(part.config.sps, part.config.pps)
          }
        }
      : undefined
    part.firstChunk = false
    part.muxer.addVideoChunkRaw(held.data, held.key ? 'key' : 'delta', held.pts, Math.max(1, duration), meta as never)
  }

  private finishPart(): void {
    const part = this.part
    if (!part) return
    this.part = null
    try {
      if (part.held) this.flushHeld(part, DEFAULT_FRAME_US)
      part.muxer.finalize()
    } finally {
      closeSync(part.fd)
      this.bytesDone += part.bytes
    }
  }

  /** Finalize the current file. Returns all part files written (possibly none if no key frame arrived). */
  stop(): string[] {
    if (!this.stopped) {
      this.stopped = true
      this.finishPart()
    }
    return this.files
  }
}
