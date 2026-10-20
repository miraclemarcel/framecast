// Stand-in for scrcpy-server v5.0.1 running on a phone, used by session.test.ts.
// Usage: node fake-scrcpy-server.mjs <reverse|forward> <port> [crash]
//  - reverse: connects to the client (video socket, then control socket)
//  - forward: listens; the client connects; a dummy byte is sent on the first socket
// It speaks the real wire format: device meta, codec id, session packet, media packets,
// and echoes every control message back as a clipboard device message (hex).
import { connect, createServer } from 'node:net'

const [mode, portArg, behaviour] = process.argv.slice(2)
const port = Number(portArg)

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}

function packet(payload, { config = false, key = false, pts = 0n } = {}) {
  const h = Buffer.alloc(12)
  let first = config ? 1n << 62n : pts
  if (key) first |= 1n << 61n
  h.writeBigUInt64BE(first)
  h.writeUInt32BE(payload.length, 8)
  return Buffer.concat([h, payload])
}

function session(w, h) {
  return Buffer.concat([u32(0x80000000), u32(w), u32(h)])
}

function streamVideo(video) {
  const name = Buffer.alloc(64)
  name.write('Fake Phone')
  video.write(Buffer.concat([name, u32(0x68323634), session(1080, 2400)]))
  video.write(packet(Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0, 0, 0, 1, 0x68, 0xce]), { config: true }))
  video.write(packet(Buffer.from([0, 0, 0, 1, 0x65, 1, 2, 3]), { key: true, pts: 1000n }))
  if (behaviour === 'crash') setTimeout(() => process.exit(1), 100)
}

function serveControl(control) {
  control.on('data', (data) => {
    const text = Buffer.from(data.toString('hex'))
    control.write(Buffer.concat([Buffer.from([0]), u32(text.length), text]))
  })
  control.on('close', () => process.exit(0))
  control.on('error', () => process.exit(0))
}

if (mode === 'reverse') {
  const video = connect({ host: '127.0.0.1', port }, () => {
    const control = connect({ host: '127.0.0.1', port }, () => {
      streamVideo(video)
      serveControl(control)
    })
  })
  video.on('error', () => process.exit(2))
} else {
  const sockets = []
  const server = createServer((socket) => {
    sockets.push(socket)
    if (sockets.length === 1) socket.write(Buffer.from([0])) // dummy byte
    if (sockets.length === 2) {
      server.close()
      streamVideo(sockets[0])
      serveControl(sockets[1])
    }
  })
  server.listen(port, '127.0.0.1')
}
setTimeout(() => process.exit(3), 20000).unref()
