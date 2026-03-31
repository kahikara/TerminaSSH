import { X } from 'lucide-react'

type StartupRecoveryResultDialogProps = {
  isOpen: boolean
  lang: string
  recoveryKey: string
  onCopy: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  onClose: () => void
}

export default function StartupRecoveryResultDialog({
  isOpen,
  lang,
  recoveryKey,
  onCopy,
  onDownload,
  onClose
}: StartupRecoveryResultDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[560px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] shadow-2xl overflow-hidden">
        <div className="min-h-[52px] px-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
          <div className="text-[14px] font-bold text-[var(--text-main)]">
            {lang === 'de' ? 'Neuer Recovery Key' : 'New recovery key'}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="ui-icon-btn"
            title={lang === 'de' ? 'Schließen' : 'Close'}
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <div className="text-[13px] leading-[1.5] text-[var(--text-muted)] whitespace-pre-line">
            {lang === 'de'
              ? 'Dein Master Passwort wurde zurückgesetzt. Speichere diesen neuen Recovery Key jetzt sicher.'
              : 'Your master password was reset. Save this new recovery key somewhere safe now.'}
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-3 py-3 text-[13px] font-semibold tracking-[0.04em] text-[var(--text-main)] break-all">
            {recoveryKey}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))] flex justify-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => { void onCopy() }}
            className="ui-btn-ghost"
          >
            {lang === 'de' ? 'Kopieren' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={() => { void onDownload() }}
            className="ui-btn-ghost"
          >
            {lang === 'de' ? 'Key herunterladen' : 'Download key'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="ui-btn-primary"
          >
            {lang === 'de' ? 'Weiter' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
