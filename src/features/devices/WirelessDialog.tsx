import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, cx, Dialog, Select, TextInput } from '@components/ui'
import { call, errorInfoOf } from '../../renderer/api'
import { actions, useApp } from '../../renderer/store'
import { deviceDisplayName } from './selection'

type Tab = 'pair' | 'connect' | 'usb'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-subtle">{hint}</span>}
    </label>
  )
}

const parsePort = (v: string): number => Number.parseInt(v, 10)

export function WirelessDialog() {
  const open = useApp((s) => s.dialog === 'wireless')
  const conn = useApp((s) => s.settings.connection)
  const usbDevices = useApp((s) => s.devices.filter((d) => d.kind === 'usb' && d.state === 'device'))
  const [tab, setTab] = useState<Tab>('pair')
  const [host, setHost] = useState('')
  const [pairPort, setPairPort] = useState('')
  const [code, setCode] = useState('')
  const [connectPort, setConnectPort] = useState('')
  const [usbSerial, setUsbSerial] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string; hint?: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setHost(conn.lastWirelessHost)
    setConnectPort(String(conn.wirelessPort))
    setMessage(null)
    setTab(usbDevices.length ? 'usb' : 'pair')
    setUsbSerial(usbDevices[0]?.serial ?? '')
    // Only when the dialog opens.
  }, [open])

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ ok: true, text: await fn() })
    } catch (err) {
      const info = errorInfoOf(err)
      setMessage({ ok: false, text: info.detail ? `${info.message} (${info.detail})` : info.message, hint: info.hint })
    } finally {
      setBusy(false)
    }
  }

  const pair = () =>
    run(async () => {
      await call('devices:pair', { host: host.trim(), port: parsePort(pairPort), code: code.trim() })
      const target = await call('devices:connectWireless', { host: host.trim(), port: parsePort(connectPort) })
      return `Paired and connected to ${target}.`
    })

  const connect = () =>
    run(async () => `Connected to ${await call('devices:connectWireless', { host: host.trim(), port: parsePort(connectPort) })}.`)

  const enableTcpip = () =>
    run(async () => {
      const target = await call('devices:enableTcpip', { serial: usbSerial, port: conn.wirelessPort })
      return `Connected to ${target}. You can unplug the USB cable.`
    })

  const tabs: { id: Tab; label: string }[] = [
    { id: 'usb', label: 'Switch from USB' },
    { id: 'pair', label: 'Pair (Android 11+)' },
    { id: 'connect', label: 'Connect by IP' }
  ]

  return (
    <Dialog
      open={open}
      onClose={() => actions.openDialog(null)}
      title="Wireless connection"
      description="Phone and computer must be on the same Wi-Fi network."
    >
      <div className="px-5 pt-4">
        <div className="flex gap-1 rounded-lg bg-raised p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => (setTab(t.id), setMessage(null))}
              className={cx(
                'flex-1 rounded-md py-1.5 text-xs font-medium',
                tab === t.id ? 'bg-overlay text-fg shadow' : 'text-muted hover:text-fg'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {tab === 'usb' && (
          <>
            <p className="text-xs leading-relaxed text-muted">
              Uses a phone already connected by USB: FrameCast switches it to TCP/IP mode on port {conn.wirelessPort} and connects to its
              Wi-Fi address. Works on most Android versions; the setting resets when the phone reboots.
            </p>
            {usbDevices.length ? (
              <Field label="USB device">
                <Select
                  label="USB device"
                  className="w-full"
                  value={usbSerial}
                  onChange={setUsbSerial}
                  options={usbDevices.map((d) => ({ value: d.serial, label: deviceDisplayName(d) }))}
                />
              </Field>
            ) : (
              <p className="rounded-md bg-raised p-3 text-xs text-muted">Connect and authorize a phone over USB first.</p>
            )}
          </>
        )}

        {tab === 'pair' && (
          <>
            <p className="text-xs leading-relaxed text-muted">
              On the phone: Developer options → Wireless debugging → Pair device with pairing code. Enter the IP, pairing port and code
              shown there, plus the connection port from the main Wireless debugging screen.
            </p>
            <Field label="IP address">
              <TextInput className="w-full" placeholder="192.168.1.42" value={host} onChange={(e) => setHost(e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pairing port">
                <TextInput className="w-full" inputMode="numeric" placeholder="37121" value={pairPort} onChange={(e) => setPairPort(e.target.value)} />
              </Field>
              <Field label="Pairing code">
                <TextInput className="w-full" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field label="Connect port">
                <TextInput className="w-full" inputMode="numeric" placeholder="41235" value={connectPort} onChange={(e) => setConnectPort(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {tab === 'connect' && (
          <>
            <p className="text-xs leading-relaxed text-muted">
              For phones already paired, or set to TCP/IP mode (adb tcpip). Android 11+ shows the IP and port under Wireless debugging.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="IP address">
                  <TextInput className="w-full" placeholder="192.168.1.42" value={host} onChange={(e) => setHost(e.target.value)} />
                </Field>
              </div>
              <Field label="Port">
                <TextInput className="w-full" inputMode="numeric" value={connectPort} onChange={(e) => setConnectPort(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {message && (
          <div
            role="status"
            className={cx('rounded-md p-3 text-xs leading-relaxed', message.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger')}
          >
            <p className="select-text">{message.text}</p>
            {message.hint && <p className="mt-1 text-muted">{message.hint}</p>}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={() => actions.openDialog(null)}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={busy || (tab === 'usb' && !usbSerial) || (tab !== 'usb' && !host.trim())}
          onClick={() => void (tab === 'pair' ? pair() : tab === 'connect' ? connect() : enableTcpip())}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {tab === 'pair' ? 'Pair & connect' : tab === 'connect' ? 'Connect' : 'Switch to Wi-Fi'}
        </Button>
      </div>
    </Dialog>
  )
}
