# Contributing to FrameCast

Thanks for helping improve FrameCast! Bug reports, device test results, documentation fixes, new device frames and code are
all welcome.

## Ground rules

- Be respectful and constructive.
- By contributing you agree to the terms in [LICENSE](LICENSE) (section 4: contributions).
- Never include personal data from your phone (screenshots of private apps, phone numbers, account names) in issues or PRs.

## Reporting bugs

Open a [bug report](https://github.com/miraclemarcel/framecast/issues/new/choose) with your FrameCast version, Windows version,
phone model, Android version, connection type, and an excerpt of `%APPDATA%\FrameCast\logs\framecast.log`.

Phone-specific problems (a manufacturer that blocks input, an encoder that fails at some resolution) are especially useful,
because they can't be reproduced without the hardware.

## Development setup

```powershell
git clone https://github.com/miraclemarcel/framecast.git
cd framecast
npm install
npm run fetch-deps   # scrcpy-server + adb, checksum-verified
npm run dev          # F12 opens DevTools
```

> If Electron fails with *"Cannot read properties of undefined (reading 'requestSingleInstanceLock')"*, your terminal set
> `ELECTRON_RUN_AS_NODE` (VS Code does). Run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first.

## Before opening a pull request

```powershell
npm run typecheck
npm test
```

- Keep changes focused; one topic per PR.
- Match the existing style: TypeScript strict mode, small pure modules for logic (they're unit-tested), React components
  for UI only.
- Add or update tests for logic changes. Parsing, protocol, geometry, coordinate mapping and state transitions all have
  test suites in `tests/`.
- For changes to mirroring, input or capture, test with a real phone and say which one in the PR.
- Update the README or `docs/` when behaviour changes.

## Where things live

See the project layout in the [README](README.md#project-structure) and the design notes in
[docs/architecture.md](docs/architecture.md).

### Adding a device frame

Frames are procedural. Add a profile to `src/features/device-frame/profiles.ts` (bezels, radii, cutout, buttons) and its id
to `FRAME_PROFILE_IDS` in `src/shared/settings.ts`. Geometry tests run automatically for every profile. Don't copy
manufacturer artwork, and don't use trademarks in profile names.

### Upgrading scrcpy-server

The client/server protocol is version-locked. Update `SCRCPY_SERVER_VERSION` in `src/services/scrcpy/protocol.ts`, the URL
and SHA-256 in `scripts/fetch-deps.mjs`, and then diff upstream `doc/develop.md`, `ControlMessageReader.java` and
`Streamer.java` against the previous tag.

## Releasing (maintainers)

1. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v1.1.0 && git push origin v1.1.0`.
3. The **Release** workflow builds `FrameCast-Setup-x64.exe` and publishes it to GitHub Releases.
