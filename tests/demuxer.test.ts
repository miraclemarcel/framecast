import { describe, expect, it } from 'vitest'
import { ByteQueue, DeviceMessageParser, VideoStreamDemuxer, type VideoStreamEvent } from '@services/scrcpy/demuxer'
import { CODEC_ID_H264 } from '@services/scrcpy/protocol'

function deviceMeta(name: string): Buffer {
  const buf = Buffer.alloc(64)
  buf.write(name, 'utf8')
  return buf
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

function session(w: number, h: number, clientResize = false): Buffer {
  const b = Buffer.alloc(12)
  b.writeUInt32BE((0x80000000 | (clientResize ? 1 : 0)) >>> 0, 0)
  b.writeUInt32BE(w, 4)
  b.writeUInt32BE(h, 8)
  return b
}

function packet(payload: Buffer, opts: { config?: boolean; key?: boolean; pts?: bigint }): Buffer {
  const header = Buffer.alloc(12)
  let first = opts.config ? 1n << 62n : (opts.pts ?? 0n)
  if (opts.key) first |= 1n << 61n
  header.writeBigUInt64BE(first, 0)
  header.writeUInt32BE(payload.length, 8)
  return Buffer.concat([header, payload])
}

function stream(): Buffer {
  return Buffer.concat([
    deviceMeta('Pixel 7'),
    u32(CODEC_ID_H264),
    session(1080, 2400),
    packet(Buffer.from([0, 0, 0, 1, 0x67, 1, 2, 3]), { config: true }),
    packet(Buffer.from([0, 0, 0, 1, 0x65, 9, 9]), { key: true, pts: 123456n }),
    packet(Buffer.from([0, 0, 0, 1, 0x41, 7]), { pts: 140000n }),
    session(2400, 1080)
  ])
}

const expected: VideoStreamEvent[] = [
  { type: 'deviceMeta', deviceName: 'Pixel 7' },
  { type: 'codec', codecId: CODEC_ID_H264 },
  { type: 'session', width: 1080, height: 2400, clientResize: false },
  { type: 'packet', config: true, key: false, pts: 0, data: Buffer.from([0, 0, 0, 1, 0x67, 1, 2, 3]) },
  { type: 'packet', config: false, key: true, pts: 123456, data: Buffer.from([0, 0, 0, 1, 0x65, 9, 9]) },
  { type: 'packet', config: false, key: false, pts: 140000, data: Buffer.from([0, 0, 0, 1, 0x41, 7]) },
  { type: 'session', width: 2400, height: 1080, clientResize: false }
]

describe('VideoStreamDemuxer', () => {
  it('parses a complete stream in one chunk', () => {
    const d = new VideoStreamDemuxer({ expectDummyByte: false, expectDeviceMeta: true })
    expect(d.push(stream())).toEqual(expected)
  })

  it('parses the same stream delivered one byte at a time', () => {
    const d = new VideoStreamDemuxer({ expectDummyByte: false, expectDeviceMeta: true })
    const data = stream()
    const events: VideoStreamEvent[] = []
    for (let i = 0; i < data.length; i++) events.push(...d.push(data.subarray(i, i + 1)))
    expect(events).toEqual(expected)
  })

  it('skips the dummy byte for forward tunnels', () => {
    const d = new VideoStreamDemuxer({ expectDummyByte: true, expectDeviceMeta: true })
    expect(d.push(Buffer.concat([Buffer.from([0]), stream()]))).toEqual(expected)
  })

  it('reports a disabled stream with configuration error', () => {
    const d = new VideoStreamDemuxer({ expectDummyByte: false, expectDeviceMeta: true })
    expect(d.push(Buffer.concat([deviceMeta('X'), u32(1)]))).toEqual([
      { type: 'deviceMeta', deviceName: 'X' },
      { type: 'disabled', error: true }
    ])
  })

  it('rejects absurd packet sizes', () => {
    const d = new VideoStreamDemuxer({ expectDummyByte: false, expectDeviceMeta: false, maxPacketSize: 100 })
    const header = Buffer.alloc(12)
    header.writeUInt32BE(1000, 8)
    expect(() => d.push(Buffer.concat([u32(CODEC_ID_H264), header]))).toThrow(/Invalid video packet size/)
  })

  it('reads the client-resize flag of session packets', () => {
    const d = new VideoStreamDemuxer({ expectDummyByte: false, expectDeviceMeta: false })
    expect(d.push(Buffer.concat([u32(CODEC_ID_H264), session(720, 1280, true)]))[1]).toEqual({
      type: 'session',
      width: 720,
      height: 1280,
      clientResize: true
    })
  })
})

describe('ByteQueue', () => {
  it('takes and peeks across chunk boundaries', () => {
    const q = new ByteQueue()
    q.push(Buffer.from([1, 2]))
    q.push(Buffer.from([3, 4, 5]))
    expect([...q.peek(4)]).toEqual([1, 2, 3, 4])
    expect([...q.take(3)]).toEqual([1, 2, 3])
    expect(q.length).toBe(2)
    expect([...q.take(2)]).toEqual([4, 5])
    expect(() => q.take(1)).toThrow(RangeError)
  })
})

describe('DeviceMessageParser', () => {
  it('parses clipboard and ack messages split across chunks', () => {
    const text = Buffer.from('copied text')
    const clip = Buffer.concat([Buffer.from([0]), u32(text.length), text])
    const ack = Buffer.alloc(9)
    ack[0] = 1
    ack.writeBigUInt64BE(42n, 1)
    const all = Buffer.concat([clip, ack])
    const p = new DeviceMessageParser()
    expect(p.push(all.subarray(0, 3))).toEqual([])
    expect(p.push(all.subarray(3, 10))).toEqual([])
    expect(p.push(all.subarray(10))).toEqual([
      { type: 'clipboard', text: 'copied text' },
      { type: 'ackClipboard', sequence: 42n }
    ])
  })

  it('throws on unknown message types', () => {
    expect(() => new DeviceMessageParser().push(Buffer.from([9]))).toThrow(/Unknown device message/)
  })
})
