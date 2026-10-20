# Test results

## Automated (`npm test`)

Run on Windows 11 (10.0.22000), Node 24.13.0, 2026-10-20: **11 files, 114 tests, all passing.**

| Suite | What it covers |
|---|---|
| `adb-parse.test.ts` | `adb devices -l` rows (usb, wireless, unauthorized, no permissions, offline, unknown), getprop/wm parsing, Wi-Fi IP, adb version |
| `control.test.ts` | Control-message bytes vs. scrcpy v5.0.1 upstream vectors, fixed-point encoding, UTF-8 truncation, command mapping |
| `demuxer.test.ts` | v5 video stream (meta, codec, session packets, media packets) whole and byte-by-byte, dummy byte, disabled stream, corrupt sizes, device messages |
| `h264.test.ts` | Annex B splitting, codec string, avcC, AVCC conversion |
| `frame-geometry.test.ts` | Every frame profile in portrait/landscape, bezel orientation, rotation math, fit scaling, SVG output |
| `input-mapping.test.ts` | Pointer → video coordinates (scaled, letterboxed, clamped, rotated), pinch mirror point, wheel, keyboard classification |
| `state.test.ts` | Mirror state machine transitions, device selection, error classification |
| `settings.test.ts` | Schema defaults, patch merging, validation, per-section recovery, atomic persistence |
| `process.test.ts` | Process registry kill-all, Windows process-tree kill, adb locator priorities, server argument safety |
| `controller.test.ts` | Start/stop, preflight errors, auto-reconnect, waiting for device, retry limit, clipboard, MP4 recording incl. rotation split, device monitor |
| `session.test.ts` | Real `ScrcpySession` against a fake device server over TCP: reverse and forward tunnels, control round-trip, server crash, version mismatch |

## App launch (no phone)

Verified by driving the built and the packaged app with Playwright:
- the UI renders (empty state, settings, setup guide, Wi-Fi dialog)
- the packaged app finds `resources/bin/scrcpy-server-v5.0.1`, and resolves both system adb (36.0.2) and bundled adb (37.0.1)
- IPC rejects malformed serials

## Real-device checklist (USB)

Device: **TECNO KL4, Android 14**, USB, Windows 11, system adb 36.0.2, 2026-10-20.
Results come from the user's own session, as recorded in `framecast.log`. Items without evidence remain pending.

| # | Check | Result |
|---|---|---|
| 1 | Device is discovered | ✅ Listed and mirrored (`12922554AS009182`) |
| 2 | Live screen appears inside the frame | ✅ Session started: `Device: [TECNO] TECNO KL4 (Android 14)` |
| 3 | Touch: tap, drag, scroll, long press | pending confirmation |
| 4 | Keyboard: text, Enter/Backspace, Ctrl+V paste | pending confirmation |
| 5 | Rotation: frame and input follow | pending confirmation |
| 6 | Screenshot and framed screenshot saved | pending confirmation |
| 7 | Recording saved and playable | pending confirmation |
| 8 | Unplug/replug: auto-reconnect | ✅ Session closed → retry waited for the device → mirroring resumed automatically |
| 9 | Closing the app leaves no adb shell / server process | pending confirmation |
| 10 | Compact mode (frame-only window) | pending confirmation |
