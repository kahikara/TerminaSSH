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

  return (
    <div className="fixed inset-0 z-[260]" onMouseDown={onClose}>
      <div
        className="fixed w-[220px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] shadow-2xl p-2 flex flex-col gap-1"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 228)),
          top: Math.max(8, Math.min(y, window.innerHeight - (isLocal ? 108 : 176)))
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          onClick={onOpen}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          {isLocal ? <TermIcon size={14} /> : <Server size={14} />}
          <span>{t('open', lang)}</span>
        </button>

        <button
          onClick={onOpenInNewTab}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Plus size={14} />
          <span>{t('openInNewTab', lang)}</span>
        </button>

        <button
          onClick={onOpenInSplit}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Folder size={14} />
          <span>{t('openInSplit', lang)}</span>
        </button>

        {!isLocal && (
          <>
            <div className="h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] my-1" />

            <button
              onClick={onEdit}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <SquarePen size={14} />
              <span>{t('edit', lang)}</span>
            </button>

            <button
              onClick={onDuplicate}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus size={14} />
              <span>{t('duplicate', lang)}</span>
            </button>

            <button
              onClick={onDelete}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--danger)] hover:text-white hover:bg-[var(--danger)] transition-colors"
            >
              <X size={14} />
              <span>{t('delete', lang)}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
