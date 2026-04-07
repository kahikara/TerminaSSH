import React from "react"
import type { InputContextMenuState } from "../hooks/useInputContextMenu"

type ExtraInputContextAction = {
  key: string
  label: string
  onClick: () => void | Promise<void>
  separatorBefore?: boolean
  danger?: boolean
  disabled?: boolean
}

type Props = {
  inputMenu: InputContextMenuState
  lang: string
  onAction: (action: "copy" | "paste" | "cut" | "selectAll") => void | Promise<void>
  extraActions?: ExtraInputContextAction[]
}

export default function InputContextMenu({ inputMenu, lang, onAction, extraActions = [] }: Props) {
  if (!inputMenu.open) return null

  const itemClass =
    "w-full px-3 py-2 text-left text-[12px] leading-[1.15] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

  const dividerClass =
    "h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]"

  return (
    <div
      data-input-context-menu="true"
      className="fixed z-[320] w-[164px] rounded-lg border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-xl overflow-hidden"
      style={{ left: inputMenu.x, top: inputMenu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("cut")}
        className={itemClass}
      >
        {lang === "de" ? "Ausschneiden" : "Cut"}
      </button>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("copy")}
        className={itemClass}
      >
        {lang === "de" ? "Kopieren" : "Copy"}
      </button>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("paste")}
        className={itemClass}
      >
        {lang === "de" ? "Einfügen" : "Paste"}
      </button>

      {extraActions.length > 0 && (
        <>
          <div className={dividerClass} />

          {extraActions.map((action) => (
            <React.Fragment key={action.key}>
              {action.separatorBefore && (
                <div className={dividerClass} />
              )}

              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (action.disabled) return
                  void action.onClick()
                }}
                disabled={action.disabled}
                className={itemClass}
                style={{
                  color: action.danger ? "var(--danger, #ef4444)" : "var(--text-main)"
                }}
              >
                {action.label}
              </button>
            </React.Fragment>
          ))}
        </>
      )}

      <div className={dividerClass} />

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("selectAll")}
        className={itemClass}
      >
        {lang === "de" ? "Alles auswählen" : "Select all"}
      </button>
    </div>
  )
}
