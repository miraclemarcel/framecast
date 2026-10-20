# Third-party software in FrameCast

FrameCast redistributes or bundles the components below. Versions are pinned in
`package.json`, `package-lock.json` and `scripts/fetch-deps.mjs`.

## Shipped as separate binaries (`resources/bin`)

| Component | Version | License | Source | Notes |
|---|---|---|---|---|
| scrcpy-server | 5.0.1 | Apache-2.0 | https://github.com/Genymobile/scrcpy | Unmodified official release asset (SHA-256 `764eb6f7…bc536`). Pushed to the phone and run there. Copyright © 2018 Genymobile, © 2018-2026 Romain Vimont. Full text: `licenses/scrcpy-LICENSE.txt`. |
| Android SDK Platform-Tools (adb.exe, AdbWinApi.dll, AdbWinUsbApi.dll, libwinpthread-1.dll) | 37.0.1 | Apache-2.0 (AOSP sources) with third-party components listed in `bin/platform-tools/NOTICE.txt`; binaries distributed by Google under the Android SDK terms | https://developer.android.com/tools/releases/platform-tools | Unmodified files from Google's official archive (SHA-1 `e03e78b1…1110`). The same files are redistributed by other open-source tools such as scrcpy. **Review the Android SDK License Agreement before commercial distribution**; if in doubt, ship without them and set "ADB executable" to *Android SDK / PATH*. |

## Bundled in the application (npm runtime dependencies)

| Package | Version | License |
|---|---|---|
| electron (incl. Chromium, Node.js, FFmpeg — see `LICENSES.chromium.html` in the install folder) | 44.9.1 | MIT |
| react, react-dom | 19.3.1 | MIT |
| zustand | 5.0.15 | MIT |
| zod | 4.6.7 | MIT |
| lucide-react | 1.60.0 | ISC |
| mp4-muxer | 5.2.2 | MIT |

## Build-time only (not shipped)

| Package | Version | License |
|---|---|---|
| electron-vite | 6.0.0 | MIT |
| electron-builder | 26.15.3 | MIT |
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| tailwindcss, @tailwindcss/vite | 4.3.3 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vitest | 5.0.5 | MIT |
| @types/node, @types/react, @types/react-dom | 26.6.5 / 19.3.0 / 19.3.0 | MIT |

## Device frame artwork

All device frames are generated procedurally by FrameCast (`src/features/device-frame`).
No manufacturer artwork, photos or trademarks are used. Profile names ("Contour",
"Slate", "Edge", "Notch") describe general styles; no affiliation with Google,
Samsung or any other manufacturer is implied.

## H.264

Video is decoded by Chromium's platform/FFmpeg decoders shipped with Electron and
encoded by the phone's own hardware encoder. Recording copies the phone's H.264
stream into MP4 without re-encoding. H.264 may be subject to patent licensing in
some jurisdictions for commercial products.
