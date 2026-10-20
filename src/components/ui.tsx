import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
  secondary: 'bg-raised text-fg border border-line hover:border-line-strong hover:bg-overlay',
  ghost: 'text-muted hover:text-fg hover:bg-raised',
  danger: 'bg-danger text-white hover:brightness-110'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  shortcut,
  active,
  className,
  children,
  tooltipSide = 'top',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  shortcut?: string
  active?: boolean
  tooltipSide?: 'top' | 'bottom'
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        className={cx(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-35',
          active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg',
          className
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function Tooltip({
  label,
  shortcut,
  side = 'top',
  children
}: {
  label: string
  shortcut?: string
  side?: 'top' | 'bottom'
  children: ReactNode
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-overlay px-2 py-1 text-xs whitespace-nowrap text-fg opacity-0 shadow-lg transition-opacity delay-300 group-hover/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
        )}
      >
        {label}
        {shortcut && <kbd className="ml-2 font-mono text-[11px] text-subtle">{shortcut}</kbd>}
      </span>
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-45',
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-4'
        )}
      />
    </button>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value)
        if (opt) onChange(opt.value)
      }}
      className={cx(
        'h-8 rounded-md border border-line bg-raised px-2 text-[13px] outline-none hover:border-line-strong focus:border-accent',
        className
      )}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-8 rounded-md border border-line bg-raised px-2.5 text-[13px] outline-none select-text placeholder:text-subtle hover:border-line-strong focus:border-accent',
        className
      )}
      {...props}
    />
  )
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-lg',
  footer
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  width?: string
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="no-drag fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-6" onMouseDown={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(
          'flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl outline-none',
          width
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-raised hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function StatusDot({ tone, pulse }: { tone: 'ready' | 'warning' | 'error' | 'muted' | 'accent'; pulse?: boolean }) {
  const color = {
    ready: 'bg-ok',
    warning: 'bg-warn',
    error: 'bg-danger',
    muted: 'bg-subtle',
    accent: 'bg-accent'
  }[tone]
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', color, pulse && 'animate-rec')} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>
  )
}
