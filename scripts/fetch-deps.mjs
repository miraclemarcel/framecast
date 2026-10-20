#!/usr/bin/env node
/**
 * Downloads the third-party binaries FrameCast bundles, verifying checksums:
 *  - scrcpy-server v5.0.1 (Apache-2.0) from the official GitHub release
 *  - Android SDK Platform-Tools r37.0.1 for Windows (adb) from Google
 *
 * Output: resources/bin/scrcpy-server-v5.0.1 and resources/bin/platform-tools/
 * Usage:  node scripts/fetch-deps.mjs [--force]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(root, 'resources', 'bin')
const force = process.argv.includes('--force')

const SCRCPY = {
  version: '5.0.1',
  url: 'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-server-v5.0.1',
  sha256: '764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536',
  out: join(binDir, 'scrcpy-server-v5.0.1')
}

const PLATFORM_TOOLS = {
  version: '37.0.1',
  url: 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip',
  // From https://dl.google.com/android/repository/repository2-3.xml
  sha1: 'e03e78b1d80b396f1c3358e31251cb31740e1110',
  outDir: join(binDir, 'platform-tools'),
  files: ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll', 'NOTICE.txt', 'source.properties']
}

async function download(url) {
  process.stdout.write(`Downloading ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

function verify(buf, algorithm, expected, label) {
  const actual = createHash(algorithm).update(buf).digest('hex')
  if (actual !== expected) throw new Error(`${label}: ${algorithm} mismatch (expected ${expected}, got ${actual})`)
  process.stdout.write(`  ${label}: ${algorithm} OK\n`)
}

async function fetchServer() {
  if (!force && existsSync(SCRCPY.out)) {
    verify(readFileSync(SCRCPY.out), 'sha256', SCRCPY.sha256, 'scrcpy-server (cached)')
    return
  }
  const buf = await download(SCRCPY.url)
  verify(buf, 'sha256', SCRCPY.sha256, 'scrcpy-server')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(SCRCPY.out, buf)
}

async function fetchPlatformTools() {
  const marker = join(PLATFORM_TOOLS.outDir, 'adb.exe')
  if (!force && existsSync(marker)) {
    process.stdout.write('  platform-tools: already present (use --force to refresh)\n')
    return
  }
  const zip = await download(PLATFORM_TOOLS.url)
  verify(zip, 'sha1', PLATFORM_TOOLS.sha1, 'platform-tools')

  const work = mkdtempSync(join(tmpdir(), 'framecast-pt-'))
  try {
    const zipPath = join(work, 'platform-tools.zip')
    writeFileSync(zipPath, zip)
    // bsdtar ships with Windows 10+ and extracts zip archives. Use it explicitly: a GNU tar
    // earlier in PATH (e.g. Git Bash) misreads "C:\..." as a remote host.
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows','System32', 'tar.exe') : 'unzip'
    const args = process.platform === 'win32' ? ['-xf', zipPath, '-C', work] : ['-q', zipPath, '-d', work]
    execFileSync(tar, args, { stdio: 'inherit' })
    mkdirSync(PLATFORM_TOOLS.outDir, { recursive: true })
    for (const file of PLATFORM_TOOLS.files) {
      const src = join(work, 'platform-tools', file)
      if (existsSync(src)) copyFileSync(src, join(PLATFORM_TOOLS.outDir, file))
      else if (file.endsWith('.exe')) throw new Error(`${file} missing from archive`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

try {
  await fetchServer()
  if (process.platform === 'win32' || process.argv.includes('--windows-adb')) await fetchPlatformTools()
  else process.stdout.write('  platform-tools: skipped (not on Windows; pass --windows-adb to force)\n')
  process.stdout.write('Dependencies ready in resources/bin\n')
} catch (err) {
  console.error(`fetch-deps failed: ${err.message}`)
  process.exit(1)
}
