import type { RefObject } from "react"
import { ChevronUp, ChevronDown, X } from "lucide-react"
import { t } from "../lib/i18n"

type Props = {
  lang: string
  searchInputRef: RefObject<HTMLInputElement | null>
  searchQuery: string
  setSearchQuery: (value: string) => void
  runSearch: (backwards?: boolean, queryOverride?: string, focusTerminal?: boolean) => void
  closeSearchBar: () => void
}

const iconOnlyBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  height: 28,
  width: 28,
  padding: 0,
  borderRadius: 8,
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  background: "var(--bg-app, #111111)",
  color: "var(--text-main, #e5e7eb)",
  cursor: "pointer",
  fontSize: 11,
  whiteSpace: "nowrap",
  transition: "background 140ms ease, border-color 140ms ease, transform 120ms ease"
} as const

const searchInputStyle = {
  flex: 1,
  height: 28,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 76%, transparent)",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  color: "var(--text-main, #e5e7eb)",
  fontSize: 11,
  outline: "none"
} as const

export default function TerminalSearchBar({
  lang,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  runSearch,
  closeSearchBar
}: Props) {
  return (
    <div
      style={{
        minHeight: 40,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
        background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))"
      }}
    >
      <input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(e) => {
          const next = e.target.value
          setSearchQuery(next)
          if (next.trim()) {
            setTimeout(() => runSearch(false, next, false), 0)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            e.stopPropagation()
            runSearch(e.shiftKey, undefined, false)
          }
        }}
        placeholder={t("search", lang)}
        style={searchInputStyle}
      />

      <button
        onClick={() => runSearch(true, undefined, false)}
        title={lang === "de" ? "Vorheriger Treffer" : "Previous match"}
        style={iconOnlyBtnStyle}
      >
        <ChevronUp size={13} />
      </button>

      <button
        onClick={() => runSearch(false, undefined, false)}
        title={lang === "de" ? "Nächster Treffer" : "Next match"}
        style={iconOnlyBtnStyle}
      >
        <ChevronDown size={13} />
      </button>

      <button
        onClick={closeSearchBar}
        title={t("close", lang)}
        style={iconOnlyBtnStyle}
      >
        <X size={13} />
      </button>
    </div>
  )
}
