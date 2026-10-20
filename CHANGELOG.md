# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-20

### Fixed
- **Compact mode:** touching or swiping on the phone screen moved the whole window instead of controlling the phone. Only
  the device frame (bezel) now moves the window; the screen always receives taps, swipes and scrolling.
- **Compact mode:** dragging the window now follows the cursor exactly at any Windows display scaling, and the window
  keeps its size while it moves.
- Clicking the phone screen no longer loses keyboard focus in some cases, so typing goes to the phone right after a click.

### Changed
- In compact mode the cursor shows a grab hand over the device frame, to show where the window can be dragged.

## [1.0.0] - 2026-10-20

### Added
- Real-time mirroring and control of Android phones over USB and Wi-Fi (scrcpy-server 5.0.1 with a TypeScript/WebCodecs
  client).
- Procedural device frames (Contour, Slate, Edge, Notch, Screen only) in four finishes.
- Compact mode: a frameless, emulator-style window with only the device and a side toolbar.
- Touch, scroll, multi-touch, pinch, keyboard (any layout, IME), clipboard sync and navigation controls.
- Screenshots (plain and framed) and MP4 recording without re-encoding.
- Device discovery, authorization guidance, Wi-Fi pairing, USB-to-Wi-Fi switching, automatic reconnection.
- Settings for frames, video quality, capture folders, connection and ADB source.
- Windows x64 installer.

[1.0.1]: https://github.com/miraclemarcel/framecast/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/miraclemarcel/framecast/releases/tag/v1.0.0
