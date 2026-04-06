import { Minus, Square, X } from 'lucide-react'

type LinuxTitlebarProps = {
  lang: string
  isWindowMaximized: boolean
  onStartDrag: () => void
  onToggleMaximize: () => void
  onMinimize: () => void
  onClose: () => void
}

export default function LinuxTitlebar({
  lang,
  isWindowMaximized,
  onStartDrag,
  onToggleMaximize,
  onMinimize,
  onClose
}: LinuxTitlebarProps) {
  return (
    <div
      className="absolute top-0 left-0 right-0 z-[300] h-[30px] flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_96%,var(--bg-app))] px-2 select-none"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement | null
        if (target?.closest('[data-window-control="true"]')) return
        e.preventDefault()
        e.stopPropagation()
        onToggleMaximize()
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement | null
        if (target?.closest('[data-window-control="true"]')) return
        if (e.detail > 1) return
        onStartDrag()
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <img
          src="/app-icon.svg"
          alt="logo"
          className="w-4 h-4 object-contain shrink-0"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <span className="text-[11px] font-semibold text-[var(--text-main)] truncate">
          Termina SSH
        </span>
      </div>

      <div className="flex items-center gap-[5px]">
        <button
          data-window-control="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onMinimize}
          className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
          title={lang === 'de' ? 'Minimieren' : 'Minimize'}
        >
          <Minus size={11} />
        </button>

        <button
          data-window-control="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onToggleMaximize}
          className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
          title={lang === 'de' ? 'Maximieren' : 'Maximize'}
        >
          <Square size={9.5} className={isWindowMaximized ? 'scale-90' : ''} />
        </button>

        <button
          data-window-control="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:bg-[var(--danger)] hover:text-white transition-colors shrink-0"
          title={lang === 'de' ? 'Schließen' : 'Close'}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )
}
