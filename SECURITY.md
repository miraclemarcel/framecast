# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through
[GitHub Security Advisories](https://github.com/miraclemarcel/framecast/security/advisories/new) with steps to reproduce and
the affected version. You can expect an initial reply within 7 days.

## Security model

- FrameCast talks to the phone only through ADB on your computer. It has no servers and no telemetry, and it never
  uploads screen content, input or files.
- The renderer is sandboxed (`contextIsolation`, `sandbox`, no Node integration, strict CSP). It reaches the system only
  through an allow-listed IPC bridge whose arguments are validated in the main process.
- ADB and the device server are started with argument arrays (never shell strings), and all child processes are
  terminated when the app exits.
- **USB debugging is powerful:** any computer you authorize can install apps and read data on the phone. Authorize only
  computers you trust, and turn USB debugging off when you don't need it.
