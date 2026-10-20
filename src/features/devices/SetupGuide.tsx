import type { ReactNode } from 'react'
import { ExternalLink, ShieldAlert } from 'lucide-react'
import { Button, Dialog } from '@components/ui'
import { call } from '../../renderer/api'
import { actions, useApp } from '../../renderer/store'

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
        {n}
      </span>
      <div className="pb-1">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  )
}

const b = (t: string) => <b className="font-medium text-fg">{t}</b>

export function SetupGuide() {
  const open = useApp((s) => s.dialog === 'setup')
  const openDocs = () =>
    void call('shell:openExternal', { url: 'https://developer.android.com/studio/debug/dev-options' }).catch(() => undefined)

  return (
    <Dialog
      open={open}
      onClose={() => actions.openDialog(null)}
      title="Connect an Android phone"
      description="One-time setup. FrameCast needs no app on your phone."
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={openDocs}>
            <ExternalLink size={13} /> Android documentation
          </Button>
          <Button variant="primary" onClick={() => actions.openDialog(null)}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <ol className="space-y-3.5">
          <Step n={1} title="Enable Developer options">
            On the phone open {b('Settings → About phone')} and tap {b('Build number')} seven times. On some phones it is under{' '}
            {b('Software information')}.
          </Step>
          <Step n={2} title="Turn on USB debugging">
            Open {b('Settings → System → Developer options')} and enable {b('USB debugging')}. On Xiaomi/Redmi/POCO phones also
            enable {b('USB debugging (Security settings)')} so touches can be injected.
          </Step>
          <Step n={3} title="Connect the cable">
            Use a USB cable that supports data (some cables only charge). If the phone asks, choose {b('File transfer')} or keep the
            default mode.
          </Step>
          <Step n={4} title="Authorize this computer">
            Unlock the phone and tap {b('Allow')} on {b('“Allow USB debugging?”')}. Check {b('Always allow from this computer')}.
          </Step>
          <Step n={5} title="Start mirroring">
            Select the phone in the top bar and click {b('Mirror')}. Click the phone screen to type into it.
          </Step>
        </ol>

        <div className="rounded-lg border border-line bg-raised p-3 text-xs leading-relaxed text-muted">
          <p className="mb-1 font-medium text-fg">Phone not detected on Windows?</p>
          Install your manufacturer’s USB driver (Samsung, Xiaomi, OnePlus…) or the {b('Google USB Driver')}, then replug the cable. If
          the device shows as {b('offline')}, toggle USB debugging off and on.
        </div>

        <div className="rounded-lg border border-line bg-raised p-3 text-xs leading-relaxed text-muted">
          <p className="mb-1 font-medium text-fg">Wireless (Android 11+)</p>
          Enable {b('Wireless debugging')} in Developer options, then use {b('Wi-Fi…')} in FrameCast to pair with a 6-digit code.
          Phone and computer must be on the same network.
        </div>

        <div className="flex gap-2.5 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-muted">
            <span className="font-medium text-fg">Security note: </span>
            USB debugging gives an authorized computer broad access to your phone — it can install apps, read files and control the
            screen. Only authorize computers you trust, and turn USB debugging off when you no longer need it. FrameCast does not
            collect or transmit anything from your phone; everything stays on this computer.
          </p>
        </div>
      </div>
    </Dialog>
  )
}
