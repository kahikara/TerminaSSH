import { t } from "../lib/i18n"

type DirtyEditorItem = {
  label: string
  fileName: string
  remotePath: string
  dirty: boolean
}

type Props = {
  isOpen: boolean
  busy: boolean
  dirtyEditors: DirtyEditorItem[]
  lang: string
  onCancel: () => void
  onConfirm: () => void
}

export default function MainCloseDialog({
  isOpen,
  busy,
  dirtyEditors,
  lang,
  onCancel,
  onConfirm
}: Props) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl">
        <div className="px-4 py-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
          <div className="text-[14px] leading-[1.2] font-bold text-[var(--text-main)]">
            {t("unsavedEditorChangesTitle", lang)}
          </div>
          <div className="text-[12px] leading-[1.4] text-[var(--text-muted)] mt-1">
            {t("unsavedEditorChangesText", lang)}
          </div>
        </div>

        <div className="px-4 py-3 max-h-72 overflow-auto">
          <div className="flex flex-col gap-3">
            {dirtyEditors.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_84%,var(--bg-app))] px-3 py-2.5"
              >
                <div className="text-sm font-medium text-[var(--text-main)] break-words">
                  {item.fileName || item.label}
                </div>
                <div className="text-xs text-[var(--text-muted)] break-words mt-1">
                  {item.remotePath || item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] flex items-center justify-end gap-2 bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))]">
          <button
            onClick={onCancel}
            className="min-h-9 px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] text-[var(--text-main)] text-[13px] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
            disabled={busy}
          >
            {t("cancel", lang)}
          </button>

          <button
            onClick={onConfirm}
            className="min-h-9 px-4 py-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)] text-white text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
            disabled={busy}
          >
            {t("closeAllAndDiscard", lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
