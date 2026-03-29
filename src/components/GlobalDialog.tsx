import { useState, useEffect } from "react"
import { X } from "lucide-react"

export default function GlobalDialog({ dialog, onClose }: any) {
  const [val, setVal] = useState("")
  const [confirmVal, setConfirmVal] = useState("")
  const [checkVal, setCheckVal] = useState(false)

  useEffect(() => {
    if (dialog.isOpen) {
      setVal(dialog.defaultValue || "")
      setConfirmVal(dialog.defaultConfirmValue || "")
      setCheckVal(Boolean(dialog.checkboxDefaultChecked))
    }
  }, [dialog.isOpen, dialog.defaultValue, dialog.defaultConfirmValue, dialog.checkboxDefaultChecked])

  if (!dialog.isOpen) return null

    const isDanger = dialog.tone === "danger"
    const title = dialog.title || "Confirm"
    const description = dialog.description || ""
    const confirmLabel =
    dialog.confirmLabel ||
    (dialog.type === "confirm" ? "OK" : "OK")
    const cancelLabel = dialog.cancelLabel || "Cancel"
    const secondaryLabel = dialog.secondaryLabel || ""
    const tertiaryLabel = dialog.tertiaryLabel || ""

    const needsDoubleInput = dialog.type === "prompt" && dialog.requireConfirm === true
    const confirmPlaceholder = dialog.confirmPlaceholder || ""
    const checkboxLabel = dialog.checkboxLabel || ""

    const validationError =
    dialog.type === "prompt" && dialog.validate
    ? dialog.validate(val, confirmVal)
    : ""

    const canSubmit =
    dialog.type !== "prompt"
    ? true
    : needsDoubleInput
    ? Boolean(val) && Boolean(confirmVal) && !validationError
    : dialog.allowEmpty === true
    ? !validationError
    : Boolean(val) && !validationError

    const confirmBtnClass = isDanger
    ? "min-h-9 px-4 py-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)] text-white text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
    : "ui-btn-primary disabled:opacity-60"

    const submit = () => {
      if (!canSubmit) return

        if (dialog.type === "prompt") {
          if (needsDoubleInput) {
            if (checkboxLabel) {
              dialog.onConfirm(val, confirmVal, { checked: checkVal })
            } else {
              dialog.onConfirm(val, confirmVal)
            }
          } else {
            if (checkboxLabel) {
              dialog.onConfirm(val, { checked: checkVal })
            } else {
              dialog.onConfirm(val)
            }
          }
        } else {
          dialog.onConfirm(val)
        }

        onClose()
    }

    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[560px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl overflow-hidden">
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
        <div className="text-[13px] leading-[1.5] text-[var(--text-muted)] whitespace-pre-line">
        {description}
        </div>
      ) : null}

      {dialog.type === "prompt" && (
        <div className="mt-3 flex flex-col gap-3">
        <input
        autoFocus
        type={dialog.isPassword ? "password" : "text"}
        placeholder={dialog.placeholder || ""}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && canSubmit) {
            submit()
          }
        }}
        className="w-full h-9 px-3 rounded-[10px] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[var(--border-subtle)] outline-none focus:border-[var(--accent)] text-[13px] text-[var(--text-main)]"
        />

        {needsDoubleInput && (
          <input
          type={dialog.isPassword ? "password" : "text"}
          placeholder={confirmPlaceholder}
          value={confirmVal}
          onChange={e => setConfirmVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && canSubmit) {
              submit()
            }
          }}
          className="w-full h-9 px-3 rounded-[10px] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[var(--border-subtle)] outline-none focus:border-[var(--accent)] text-[13px] text-[var(--text-main)]"
          />
        )}

        {checkboxLabel ? (
          <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] select-none">
            <input
              type="checkbox"
              checked={checkVal}
              onChange={e => setCheckVal(e.target.checked)}
              className="h-4 w-4 rounded border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))]"
            />
            <span>{checkboxLabel}</span>
          </label>
        ) : null}

        {validationError ? (
          <div className="text-[12px] leading-[1.4] text-[var(--danger)]">
          {validationError}
          </div>
        ) : null}
        </div>
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

      {secondaryLabel && dialog.onSecondary && (
        <button
        onClick={async () => {
          await dialog.onSecondary(val)
        }}
        className="ui-btn-ghost"
        >
        {secondaryLabel}
        </button>
      )}

      {tertiaryLabel && dialog.onTertiary && (
        <button
        onClick={async () => {
          await dialog.onTertiary(val)
        }}
        className="ui-btn-ghost"
        >
        {tertiaryLabel}
        </button>
      )}

      <button
      onClick={submit}
      className={confirmBtnClass}
      disabled={!canSubmit}
      >
      {confirmLabel}
      </button>
      </div>
      </div>
      </div>
    )
}
