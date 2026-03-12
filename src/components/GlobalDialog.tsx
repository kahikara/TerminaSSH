import React from "react"
import { useState, useEffect } from "react"
import { X } from "lucide-react"

export default function GlobalDialog({ dialog, onClose }: any) {
  const [val, setVal] = useState("")

  useEffect(() => {
    if (dialog.isOpen) setVal(dialog.defaultValue || "")
  }, [dialog.isOpen, dialog.defaultValue])

  if (!dialog.isOpen) return null

  const isDanger = dialog.tone === "danger"
  const title = dialog.title || "Confirm"
  const description = dialog.description || ""
  const confirmLabel =
    dialog.confirmLabel ||
    (dialog.type === "confirm" ? "OK" : "OK")
  const cancelLabel = dialog.cancelLabel || "Cancel"

  const confirmBtnClass = isDanger
    ? "min-h-9 px-4 py-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)] text-white text-[13px] font-medium transition-opacity hover:opacity-90"
    : "ui-btn-primary"

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[430px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl overflow-hidden">
        <div className="min-h-[52px] px-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
          <div className="text-[14px] leading-[1.2] font-bold text-[var(--text-main)]">
            {title}
          </div>

          <button onClick={onClose} className="ui-icon-btn" title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="p-4">
          {description ? (
            <div className="text-[13px] leading-[1.45] text-[var(--text-muted)]">
              {description}
            </div>
          ) : null}

          {dialog.type === "prompt" && (
            <input
              autoFocus
              type={dialog.isPassword ? "password" : "text"}
              placeholder={dialog.placeholder || ""}
              value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  dialog.onConfirm(val)
                  onClose()
                }
              }}
              className="w-full h-9 px-3 rounded-[10px] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[var(--border-subtle)] outline-none focus:border-[var(--accent)] text-[13px] text-[var(--text-main)] mt-3"
            />
          )}
        </div>

        <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))] flex justify-end gap-2">
          {dialog.type !== "alert" && (
            <button
              onClick={() => {
                if (dialog.onCancel) dialog.onCancel()
                onClose()
              }}
              className="ui-btn-ghost"
            >
              {cancelLabel}
            </button>
          )}

          <button
            onClick={() => {
              dialog.onConfirm(val)
              onClose()
            }}
            className={confirmBtnClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
