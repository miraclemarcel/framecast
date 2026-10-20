# FrameCast

Mirror and control a real Android phone from Windows, inside a realistic device frame.

FrameCast is an Electron desktop app (TypeScript, React, Tailwind, Vite). It streams the live phone screen
over USB or Wi-Fi, lets you control the phone with mouse and keyboard, and takes screenshots and MP4
recordings. Nothing needs to be installed on the phone.

## Features

- **Devices:** USB discovery, multiple devices, model/Android version/resolution/serial, authorization and driver guidance,
  Wi-Fi pairing (Android 11+), connect by IP, one-click "switch from USB to Wi-Fi".
- **Mirroring:** real-time H.264 stream decoded by the GPU (WebCodecs), aspect-correct scaling, live rotation,
  configurable resolution/bitrate/frame rate with presets, automatic reconnection.
- **Device frames:** procedurally drawn, original frames (Contour, Slate, Edge, Notch, Screen only) in four finishes, with
  punch-hole/notch cutouts, side buttons, speaker slit and shadow. Frames are built around the phone's exact aspect ratio and
  never cover the interactive screen.
- **Control:** click/drag → touch, wheel → scroll, multi-touch from touchscreens, Ctrl+drag pinch, keyboard text in any layout
  (including IME), editing keys, Ctrl+A/C/X shortcuts, Ctrl+V pastes the PC clipboard, phone clipboard syncs back.
  Back/Home/Recents/Rotate/Notifications/Volume/Power buttons and shortcuts. Full-screen mode.
- **Capture:** full-resolution screenshots (`adb screencap`), framed screenshots, MP4 recording without re-encoding.
- **Settings:** persisted locally (`%APPDATA%\FrameCast\settings.json`).

## Install (Windows 10/11 x64)

1. Run `FrameCast-Setup-<version>-x64.exe`. The installer is **not code-signed**, so SmartScreen may warn: choose
   *More info → Run anyway*.
2. ADB and the mirroring server ship with the installer. If the Android SDK is already installed (for example with
   Android Studio), FrameCast uses that `adb` instead, so the two don't fight over the adb server.

## Set up the phone

1. **Enable Developer options:** *Settings → About phone →* tap **Build number** 7 times.
2. **Enable USB debugging:** *Settings → System → Developer options → USB debugging*.
   On Xiaomi/Redmi/POCO phones, also enable **USB debugging (Security settings)**, otherwise touches are ignored.
3. Connect a **data** USB cable.
4. Unlock the phone and tap **Allow** on *"Allow USB debugging?"*. Ticking *Always allow* skips this next time.
5. In FrameCast, pick the phone in the top bar and click **Mirror**. Click the phone screen to type into it.

**Wi-Fi:** the Wi-Fi dialog has three tabs:
- *Switch from USB:* any Android version; uses `adb tcpip`.
- *Pair:* Android 11+, Wireless debugging with a 6-digit code.
- *Connect by IP.*

> **Security:** USB debugging lets an authorized computer install apps, read files and control the phone. Authorize only
> computers you trust and disable USB debugging when you are done. FrameCast never collects or transmits anything from the
> phone, and its diagnostic log records only lifecycle events and errors, never screen content, typed text or clipboard data.

## Shortcuts

| Keys | Action |
|---|---|
| Alt+B / right click | Back |
| Alt+H / middle click | Home |
| Alt+S | Recent apps |
| Alt+R | Rotate |
| Alt+N (Alt+Shift+N) | Open (close) notifications |
| Alt+↑ / Alt+↓ | Volume |
| Alt+P | Power |
| Alt+O / Alt+Shift+O | Phone screen off (keeps mirroring) / on |
| Alt+C / Alt+Shift+C | Screenshot / framed screenshot |
| Alt+V | Start/stop recording |
| F11 or Alt+F | Full screen |
| Ctrl+V | Paste the PC clipboard into the phone |
| Ctrl+drag | Pinch zoom |

## Build from source

Requirements: Windows 10/11 x64, Node.js 20.19+ or 22.12+ (developed on Node 24), npm, internet access for the first
`fetch-deps`.

```powershell
npm install
npm run fetch-deps   # downloads scrcpy-server 5.0.1 + platform-tools 37.0.1, verifies checksums → resources/bin
npm run dev          # development with hot reload (F12 opens DevTools)
npm test             # unit + integration tests
npm run typecheck
npm run dist         # fetch-deps + typecheck + tests + build + NSIS installer → release/
```

`npm run make-icon` re-renders `build/icon.png` from `build/icon.svg`.

> If you launch Electron from a VS Code terminal, `ELECTRON_RUN_AS_NODE=1` may be set, which makes Electron run as plain
> Node ("Cannot read properties of undefined (reading 'requestSingleInstanceLock')"). Unset it first:
> `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## How it works

scrcpy itself is a desktop program with its own SDL window, which can't be embedded in a web view. FrameCast therefore
reuses only scrcpy's **on-device server** (`scrcpy-server`, Apache-2.0) and implements its own client in TypeScript:

1. **Main process:** pushes `scrcpy-server v5.0.1` to `/data/local/tmp`, opens an `adb reverse` tunnel (falling back to
   `adb forward`), and starts the server with `adb shell app_process`. It then accepts the video and control sockets.
2. **Video:** the main process demuxes the v5 stream (device name, codec id, *session* packets on every rotation, 12-byte media
   headers) and forwards packets over IPC.
3. **Renderer:** decodes H.264 with WebCodecs `VideoDecoder` and draws frames directly onto a `<canvas>` in the frame's
   screen slot. Video bypasses React entirely.
4. **Input:** pointer, wheel and keyboard events are mapped from canvas coordinates to video pixels. The main process
   validates them with zod and serializes them byte-for-byte to the scrcpy control protocol, using upstream test vectors
   as unit tests.
5. **Recording:** the same H.264 packets are muxed into MP4 (`mp4-muxer`) with no re-encoding. Screenshots use
   `adb exec-out screencap -p` for native resolution.

The protocol is version-specific: the server refuses any client version other than `5.0.1`. To upgrade, change
`SCRCPY_SERVER_VERSION` and the pinned checksum in `scripts/fetch-deps.mjs`, then re-check `doc/develop.md` upstream.

More detail: [docs/architecture.md](docs/architecture.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| "No device connected" | Use a data cable, enable USB debugging, try another USB port. Run `adb devices` to confirm Windows sees the phone. |
| Phone listed as **unauthorized** | Unlock it and accept the prompt. If no prompt: unplug/replug, or *Developer options → Revoke USB debugging authorizations*. |
| **no permissions** / not listed on Windows | Install the OEM USB driver (Samsung, Xiaomi…) or the Google USB Driver, then replug. |
| **offline** | Replug; toggle USB debugging off/on; restart the phone. |
| Video shows, but taps do nothing (Xiaomi) | Enable *USB debugging (Security settings)* in Developer options (requires a Mi account). |
| "Could not encode at requested quality" | Lower *Maximum resolution* (e.g. 1280) in Settings → Video. *Lower resolution on encoder errors* retries automatically. |
| Choppy over Wi-Fi | Use the *Performance* preset (1024 px, 4 Mbit/s, 30 fps), or USB. |
| "adb server version doesn't match" in logs | Two different `adb` versions are running (e.g. bundled vs Android Studio). Set Settings → Connection → ADB to *Android SDK / PATH* or *Bundled* consistently. |
| Black screen in some apps | Apps that set `FLAG_SECURE` (banking, DRM video) block capture by design. |
| Wi-Fi connect fails | Same network? Client isolation on guest Wi-Fi blocks it. For Android 11+ use the pairing tab; the pairing port differs from the connect port. |
| Anything else | Settings → About → *Open log folder* (`%APPDATA%\FrameCast\logs\framecast.log`). |

## Project layout

```
src/main/               Electron main: window, IPC (zod-validated), mirror controller, capture, settings store, logger
src/preload/            contextBridge API (allow-listed channels only)
src/renderer/           React shell: top/bottom bars, store (zustand), styles
src/components/         UI primitives (Button, Dialog, Switch, Select, Toaster…)
src/features/devices/   device selector, info panel, Wi-Fi dialog, setup guide, selection logic
src/features/mirroring/ WebCodecs renderer, canvas input mapping, keyboard mapping, shortcuts, status screen
src/features/device-frame/  frame profiles, geometry, procedural SVG, framed-screenshot compositor
src/features/capture/   screenshot / recording actions
src/features/settings/  settings dialog
src/services/adb/       adb client, locator, parser, device monitor, server manager
src/services/scrcpy/    protocol constants, control serializer, stream demuxer, server args, session
src/services/capture/   MP4 recorder
src/services/process/   child-process registry (tree-kill on exit)
src/shared/             types, settings schema, IPC contract, state machine, errors, H.264 helpers
scripts/                fetch-deps (checksummed downloads), make-icon
tests/                  vitest suites + a fake scrcpy server for socket-level integration tests
```

## Testing

`npm test` runs 114 tests across 11 files, covering:
- ADB output parsing, device selection, the connection state machine, and the auto-reconnect controller
- frame geometry and SVG rendering, coordinate mapping (scaled, letterboxed, rotated), and keyboard mapping
- control serialization against upstream scrcpy byte vectors, and the stream/device-message demuxers
- H.264 helpers, MP4 recording (including the split on rotation), settings persistence and recovery
- process cleanup, including Windows process trees
- a full `ScrcpySession` against a fake device server over real TCP sockets, for both reverse and forward tunnels,
  server crash, and version mismatch

Hardware results are tracked in [docs/testing.md](docs/testing.md).

## Known limitations

- **No audio forwarding.** Video only (the scrcpy server supports audio; FrameCast doesn't play or record it yet).
- **One mirroring session at a time.** Several phones can be listed and switched between.
- In landscape the frame assumes the phone was rotated counter-clockwise (camera on the left); the video itself is always
  correct.
- A rotation during recording starts a new file (`…_part2.mp4`), because one MP4 track can't change resolution.
- Wireless pairing by QR code isn't supported; use the 6-digit code.
- The installer is unsigned, so SmartScreen warns on first run.
- Windows x64 only (Electron itself is cross-platform, but packaging, adb bundling and testing target Windows).

Third-party components and licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
