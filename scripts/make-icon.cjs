// Renders build/icon.svg to build/icon.png (512x512) with Electron's own Chromium.
// Usage: npx electron scripts/make-icon.cjs   (ELECTRON_RUN_AS_NODE must be unset)
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.resize({ width: 512, height: 512 }).toPNG())
  console.log('wrote build/icon.png')
  app.quit()
})
