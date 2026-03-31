import { X, Zap } from 'lucide-react'
import { t } from '../lib/i18n'

type QuickConnectDraft = {
  user: string
  host: string
  port: string
}

type QuickConnectDialogProps = {
  isOpen: boolean
  lang: string
  draft: QuickConnectDraft
  setDraft: React.Dispatch<React.SetStateAction<QuickConnectDraft>>
  onClose: () => void
  onSubmit: (e?: React.FormEvent) => void
}

export default function QuickConnectDialog({
  isOpen,
  lang,
  draft,
  setDraft,
  onClose,
  onSubmit
}: QuickConnectDialogProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[265] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="min-h-[54px] px-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-app)] border border-[var(--border-subtle)] shrink-0">
              <Zap size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-[var(--text-main)]">
                {t('quickConnect', lang)}
              </div>
              <div className="text-[12px] text-[var(--text-muted)]">
                {lang === 'de' ? 'Schnell zu einem Host verbinden' : 'Connect to a host quickly'}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="ui-icon-btn"
            title={t('close', lang)}
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_88px] gap-3">
            <input
              type="text"
              placeholder={t('quickConnectUserPlaceholder', lang)}
              value={draft.user}
              onChange={(e) => setDraft((prev) => ({ ...prev, user: e.target.value }))}
              className="h-10 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3.5 text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />

            <input
              autoFocus
              type="text"
              placeholder={t('quickConnectHostPlaceholder', lang)}
              value={draft.host}
              onChange={(e) => setDraft((prev) => ({ ...prev, host: e.target.value }))}
              className="h-10 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3.5 text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />

            <input
              type="number"
              min="1"
              max="65535"
              placeholder="22"
              value={draft.port}
              onChange={(e) => {
                const next = e.target.value
                if (next === '' || /^\d+$/.test(next)) {
                  setDraft((prev) => ({ ...prev, port: next }))
                }
              }}
              onBlur={() => {
                const parsed = parseInt(draft.port.trim() || '22', 10)
                setDraft((prev) => ({
                  ...prev,
                  port: String(Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 22)
                }))
              }}
              className="h-10 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3.5 text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn-ghost"
            >
              {t('cancel', lang)}
            </button>

            <button
              type="submit"
              className="ui-btn-primary"
              disabled={!draft.host.trim()}
            >
              {t('connect', lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
