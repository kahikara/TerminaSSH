import { ChevronsLeft, Folder, Plus, X } from 'lucide-react'

type TabContextMenuProps = {
  isOpen: boolean
  x: number
  y: number
  splitMode: boolean
  lang: string
  onClose: () => void
  onDuplicateSession: () => void
  onOpenInSplit: () => void
  onDuplicateLeftSession: () => void
  onDuplicateRightSession: () => void
  onRemoveSplit: () => void
  onCloseTab: () => void
}

export default function TabContextMenu({
  isOpen,
  x,
  y,
  splitMode,
  lang,
  onClose,
  onDuplicateSession,
  onOpenInSplit,
  onDuplicateLeftSession,
  onDuplicateRightSession,
  onRemoveSplit,
  onCloseTab
}: TabContextMenuProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[260]" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="fixed w-[220px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] shadow-2xl p-2 flex flex-col gap-1"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 228)),
          top: Math.max(8, Math.min(y, window.innerHeight - (splitMode ? 212 : 176)))
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!splitMode ? (
          <>
            <button
              onClick={onDuplicateSession}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus size={14} />
              <span>{lang === 'de' ? 'Session duplizieren' : 'Duplicate session'}</span>
            </button>

            <button
              onClick={onOpenInSplit}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Folder size={14} />
              <span>{lang === 'de' ? 'Im Split öffnen' : 'Open in split'}</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onDuplicateLeftSession}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus size={14} />
              <span>{lang === 'de' ? 'Linke Session duplizieren' : 'Duplicate left session'}</span>
            </button>

            <button
              onClick={onDuplicateRightSession}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus size={14} />
              <span>{lang === 'de' ? 'Rechte Session duplizieren' : 'Duplicate right session'}</span>
            </button>

            <button
              onClick={onRemoveSplit}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <ChevronsLeft size={14} />
              <span>{lang === 'de' ? 'Split aufheben' : 'Remove split'}</span>
            </button>
          </>
        )}

        <div className="h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] my-1" />

        <button
          onClick={onCloseTab}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--danger)] hover:text-white hover:bg-[var(--danger)] transition-colors"
        >
          <X size={14} />
          <span>{lang === 'de' ? 'Tab schließen' : 'Close tab'}</span>
        </button>
      </div>
    </div>
  )
}
