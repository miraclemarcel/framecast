import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { Settings } from '@shared/settings'

export interface AdbCandidate {
  path: string
  source: 'custom' | 'system' | 'bundled'
}

export interface LocatorEnv {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  bundledDir: string
  exists: (path: string) => boolean
}

export function adbExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'adb.exe' : 'adb'
}

function systemCandidates(e: LocatorEnv): string[] {
  const exe = adbExecutableName(e.platform)
  const dirs: string[] = []
  for (const v of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const root = e.env[v]
    if (root) dirs.push(join(root, 'platform-tools'))
  }
  if (e.platform === 'win32' && e.env.LOCALAPPDATA) dirs.push(join(e.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools'))
  for (const p of (e.env.PATH ?? e.env.Path ?? '').split(delimiter)) if (p) dirs.push(p)
  return dirs.map((d) => join(d, exe))
}

/** Ordered list of ADB executables to try, according to the user's preference. */
export function locateAdb(pref: Settings['adb'], e: LocatorEnv): AdbCandidate[] {
  const bundled: AdbCandidate = { path: join(e.bundledDir, adbExecutableName(e.platform)), source: 'bundled' }
  const system = systemCandidates(e).map((path): AdbCandidate => ({ path, source: 'system' }))
  let ordered: AdbCandidate[]
  switch (pref.source) {
    case 'custom':
      ordered = pref.customPath ? [{ path: pref.customPath, source: 'custom' }] : []
      break
    case 'bundled':
      ordered = [bundled]
      break
    case 'system':
      ordered = system
      break
    case 'auto':
      // Prefer an existing SDK installation so we don't fight Android Studio's adb server over versions.
      ordered = [...system, bundled]
      break
  }
  const seen = new Set<string>()
  return ordered.filter((c) => {
    const key = c.path.toLowerCase()
    if (seen.has(key) || !e.exists(c.path)) return false
    seen.add(key)
    return true
  })
}

export function defaultLocatorEnv(bundledDir: string): LocatorEnv {
  return { platform: process.platform, env: process.env, bundledDir, exists: existsSync }
}
