import type { InputContextMenuState } from "../hooks/useInputContextMenu"

type Props = {
  inputMenu: InputContextMenuState
  lang: string
  onAction: (action: "copy" | "paste" | "cut" | "selectAll") => void | Promise<void>
}

export default function InputContextMenu({ inputMenu, lang, onAction }: Props) {
  if (!inputMenu.open) return null

  return (
    <div
      data-input-context-menu="true"
      className="fixed z-[320] w-[176px] rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl overflow-hidden"
      style={{ left: inputMenu.x, top: inputMenu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("copy")}
        className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {lang === "de" ? "Kopieren" : "Copy"}
      </button>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("paste")}
        className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {lang === "de" ? "Einfügen" : "Paste"}
      </button>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("cut")}
        className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {lang === "de" ? "Ausschneiden" : "Cut"}
      </button>

      <div className="h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]" />

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onAction("selectAll")}
        className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {lang === "de" ? "Alles auswählen" : "Select all"}
      </button>
    </div>
  )
}
