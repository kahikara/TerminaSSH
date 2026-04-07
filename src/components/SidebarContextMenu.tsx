import { Folder, Plus, Server, SquarePen, Terminal as TermIcon, X } from 'lucide-react'
import { t } from '../lib/i18n'

type SidebarContextMenuProps = {
  isOpen: boolean
  x: number
  y: number
  isLocal: boolean
  lang: string
  onClose: () => void
  onOpen: () => void
  onOpenInNewTab: () => void
  onOpenInSplit: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export default function SidebarContextMenu({
  isOpen,
  x,
  y,
  isLocal,
  lang,
  onClose,
  onOpen,
  onOpenInNewTab,
  onOpenInSplit,
  onEdit,
  onDuplicate,
  onDelete
}: SidebarContextMenuProps) {
  if (!isOpen) return null

  const itemClass =
    'w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] leading-[1.15] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors'

  const dangerItemClass =
    'w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] leading-[1.15] text-[var(--danger)] hover:text-white hover:bg-[var(--danger)] transition-colors'

  const dividerClass =
    'h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]'

  return (
    <div className="fixed inset-0 z-[260]" onMouseDown={onClose}>
      <div
        className="fixed w-[196px] rounded-lg border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-xl overflow-hidden"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 204)),
          top: Math.max(8, Math.min(y, window.innerHeight - (isLocal ? 112 : 184)))
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button onClick={onOpen} className={itemClass}>
          {isLocal ? <TermIcon size={13} /> : <Server size={13} />}
          <span>{t('open', lang)}</span>
        </button>

        <button onClick={onOpenInNewTab} className={itemClass}>
          <Plus size={13} />
          <span>{t('openInNewTab', lang)}</span>
        </button>

        <button onClick={onOpenInSplit} className={itemClass}>
          <Folder size={13} />
          <span>{t('openInSplit', lang)}</span>
        </button>

        {!isLocal && (
          <>
            <div className={dividerClass} />

            <button onClick={onEdit} className={itemClass}>
              <SquarePen size={13} />
              <span>{t('edit', lang)}</span>
            </button>

            <button onClick={onDuplicate} className={itemClass}>
              <Plus size={13} />
              <span>{t('duplicate', lang)}</span>
            </button>

            <div className={dividerClass} />

            <button onClick={onDelete} className={dangerItemClass}>
              <X size={13} />
              <span>{t('delete', lang)}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
