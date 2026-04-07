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

  const itemClass =
    'w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] leading-[1.15] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors'

  const dangerItemClass =
    'w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] leading-[1.15] text-[var(--danger)] hover:text-white hover:bg-[var(--danger)] transition-colors'

  const dividerClass =
    'h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]'

  return (
    <div className="fixed inset-0 z-[260]" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="fixed w-[204px] rounded-lg border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-xl overflow-hidden"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 212)),
          top: Math.max(8, Math.min(y, window.innerHeight - (splitMode ? 148 : 112)))
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!splitMode ? (
          <>
            <button onClick={onDuplicateSession} className={itemClass}>
              <Plus size={13} />
              <span>{lang === 'de' ? 'Session duplizieren' : 'Duplicate session'}</span>
            </button>

            <button onClick={onOpenInSplit} className={itemClass}>
              <Folder size={13} />
              <span>{lang === 'de' ? 'Im Split öffnen' : 'Open in split'}</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={onDuplicateLeftSession} className={itemClass}>
              <Plus size={13} />
              <span>{lang === 'de' ? 'Linke Session duplizieren' : 'Duplicate left session'}</span>
            </button>

            <button onClick={onDuplicateRightSession} className={itemClass}>
              <Plus size={13} />
              <span>{lang === 'de' ? 'Rechte Session duplizieren' : 'Duplicate right session'}</span>
            </button>

            <button onClick={onRemoveSplit} className={itemClass}>
              <ChevronsLeft size={13} />
              <span>{lang === 'de' ? 'Split aufheben' : 'Remove split'}</span>
            </button>
          </>
        )}

        <div className={dividerClass} />

        <button onClick={onCloseTab} className={dangerItemClass}>
          <X size={13} />
          <span>{lang === 'de' ? 'Tab schließen' : 'Close tab'}</span>
        </button>
      </div>
    </div>
  )
}
