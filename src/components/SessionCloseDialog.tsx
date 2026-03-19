import { t } from "../lib/i18n"

type TabLike = {
  tabId: string
  name?: string
  host?: string
  username?: string
  isLocal?: boolean
}

type Props = {
  isOpen: boolean
  openTabs: TabLike[]
  lang: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export default function SessionCloseDialog({
  isOpen,
  openTabs,
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
            {t("activeTerminalSessionsTitle", lang)}
          </div>
          <div className="text-[12px] leading-[1.4] text-[var(--text-muted)] mt-1">
            {t("activeTerminalSessionsText", lang)}
          </div>
        </div>

        <div className="px-4 py-3 max-h-72 overflow-auto">
          <div className="flex flex-col gap-3">
            {openTabs.map((tab) => (
              <div
                key={tab.tabId}
                className="rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_84%,var(--bg-app))] px-3 py-2.5"
              >
                <div className="text-sm font-medium text-[var(--text-main)] break-words">
                  {tab.name || tab.host || tab.tabId}
                </div>
                <div className="text-xs text-[var(--text-muted)] break-words mt-1">
                  {tab.isLocal ? t("localTerminalShort", lang) : `${tab.username || ""}@${tab.host || ""}`}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] flex items-center justify-end gap-2 bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))]">
          <button
            onClick={onCancel}
            className="min-h-9 px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] text-[var(--text-main)] text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
          >
            {t("cancel", lang)}
          </button>

          <button
            onClick={() => void onConfirm()}
            className="min-h-9 px-4 py-2 rounded-xl border border-yellow-500 bg-yellow-500 text-black text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            {t("closeAnyway", lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
