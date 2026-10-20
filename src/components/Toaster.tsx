import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, Info, X, XCircle } from 'lucide-react'
import { actions, useApp, type Toast } from '../renderer/store'
import { call } from '../renderer/api'
import { cx } from './ui'

const ICONS = {
  info: <Info size={16} className="text-accent" />,
  success: <CheckCircle2 size={16} className="text-ok" />,
  warning: <AlertTriangle size={16} className="text-warn" />,
  error: <XCircle size={16} className="text-danger" />
}

function ToastItem({ toast }: { toast: Toast }) {
  const [showDetail, setShowDetail] = useState(false)
  return (
    <div
      role={toast.level === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto w-80 rounded-lg border border-line bg-overlay p-3 shadow-xl"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5">{ICONS[toast.level]}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{toast.title}</p>
          {toast.message && <p className="mt-0.5 text-xs break-words text-muted">{toast.message}</p>}
          {toast.hint && <p className="mt-1 text-xs text-muted">{toast.hint}</p>}
          <div className="mt-1.5 flex gap-3 empty:hidden">
            {toast.filePath && (
              <button
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                onClick={() => void call('shell:showItemInFolder', { path: toast.filePath! }).catch(() => undefined)}
              >
                <FolderOpen size={12} /> Show in folder
              </button>
            )}
            {toast.detail && (
              <button className="text-xs text-subtle hover:text-muted" onClick={() => setShowDetail((v) => !v)}>
                {showDetail ? 'Hide details' : 'Details'}
              </button>
            )}
          </div>
          {showDetail && toast.detail && (
            <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-muted select-text">
              {toast.detail}
            </pre>
          )}
        </div>
        <button aria-label="Dismiss" onClick={() => actions.dismissToast(toast.id)} className="text-subtle hover:text-fg">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export function Toaster() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className={cx('pointer-events-none fixed right-4 bottom-20 z-50 flex flex-col gap-2')}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
