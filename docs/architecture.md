# Architecture

## Integration decision

| Option | Verdict |
|---|---|
| Spawn `scrcpy.exe` as a child process | Rejected as the primary path: it opens its own SDL window that can't be placed inside the device frame. |
| `adb screenrecord` + `adb shell input` | Rejected: seconds of latency, 3-minute limit, stops on rotation, every tap costs a new process (~100–300 ms). |
| **Custom client for the official `scrcpy-server`** | **Chosen.** The server is a small Apache-2.0 jar that runs on the phone as `shell`. It captures the screen with MediaCodec and injects input. Our TypeScript client renders into our own canvas. |

The client/server protocol is internal and version-locked. FrameCast targets **scrcpy-server 5.0.1**. The protocol was
verified against that tag's `doc/develop.md`, `ControlMessageReader.java`, `Streamer.java`, `DesktopConnection.java`
and the upstream serialization tests (ported to `tests/control.test.ts`).

## Data flow

```
 Phone                                   Main process (Node)                      Renderer (sandboxed)
 ─────                                   ───────────────────                      ────────────────────
 scrcpy-server ──video socket──▶ VideoStreamDemuxer ──IPC "mirror:video"──▶ VideoRenderer (WebCodecs) ─▶ <canvas>
      ▲                                │  └─▶ Mp4Recorder (mp4-muxer, no re-encode)
      │                                │
      └──control socket◀── serializeControlMessage ◀─ zod validation ◀─IPC "mirror:control"── pointer/keyboard mapping
                         ──▶ DeviceMessageParser ──▶ clipboard sync
 adb (USB/TCP) ◀── AdbClient (execFile, argument arrays only) ◀── DeviceMonitor (1.5 s polling) / IPC handlers
```

## Session lifecycle (`src/services/scrcpy/session.ts`)

1. `adb push` the server to `/data/local/tmp/framecast-server.jar`.
2. Listen on `127.0.0.1:0` and `adb reverse localabstract:scrcpy_<scid> tcp:<port>`. If reverse is unsupported, fall back
   to `adb forward tcp:0 …` and poll until the server's dummy byte arrives.
3. `adb shell CLASSPATH=… app_process / com.genymobile.scrcpy.Server 5.0.1 scid=… tunnel_forward=… audio=false …`.
   Every argument is checked against a `[A-Za-z0-9_=./:-]` allow-list before it is sent.
4. Accept the video socket, then the control socket (kept paused until their handlers are attached), then remove the tunnel.
5. Video: `[dummy] name[64] codec:u32 (session[12] | header[12] payload)*`. Session packets announce the size after each
   rotation; config packets carry SPS/PPS.
6. Stop: destroy sockets (the server exits and restores device settings because `cleanup=true`), kill the adb shell
   process tree if needed, remove the tunnel.

## State and reconnection (`src/main/mirror-controller.ts`, `src/shared/mirror-state.ts`)

`idle → starting → streaming → stopping → idle`, plus `error` and `reconnecting`. Unexpected session ends trigger a
reconnect with backoff while the device is present, or wait for the device monitor's `ready` event when it is gone.
Configuration errors (encoder, unsupported device, missing server, unauthorized) are not retried.

## Rendering

- `VideoRenderer` keeps SPS/PPS and prepends them to the next key frame (Annex B mode). It decodes with
  `optimizeForLatency`, draws each output frame immediately, and closes frames right away. If the decoder falls behind or
  errors, it sends `RESET_VIDEO` to get a fresh key frame instead of building latency.
- `DeviceFrame` computes geometry in video pixels (`geometry.ts`), so the screen slot always has the stream's exact aspect
  ratio. The body and buttons are an SVG under the canvas; the camera cutout is an SVG above it with
  `pointer-events: none`.
- Input coordinates come from the canvas bounding box only, so clicks on the frame never reach the phone. They are sent in
  the current video size, which the server checks before mapping.

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a strict CSP. Popups and navigation are blocked,
  and all permission requests are denied.
- The preload exposes allow-listed channels only. Every invoke argument and control command is re-validated in the main
  process with zod, and only frames from the app's own origin are accepted.
- No shell strings: `execFile`/`spawn` with `shell: false`. Serials, hosts, ports and pairing codes are regex-validated.
- `shell:showItemInFolder` only reveals files FrameCast saved; `openExternal` only allows https on an allow-list.
- Every child process is tracked by `ProcessRegistry` and tree-killed on exit (`taskkill /T /F`). The adb server is stopped
  only if FrameCast started it.
