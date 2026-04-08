import { t } from "../lib/i18n"
import type { AppSettings, ToolToggleKey } from "../lib/types"
import { SettingCard, FieldRow, Toggle } from "./SettingsUi"

type Props = {
  lang: string
  ui: any
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  uniformNumberInputStyle: React.CSSProperties
  uniformSelectStyle: React.CSSProperties
}

type ToolItem = {
  key: ToolToggleKey
  label: string
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

export default function SettingsTerminalSection({
  lang,
  ui,
  settings,
  setSettings,
  uniformNumberInputStyle,
  uniformSelectStyle
}: Props) {
  const toolItems: ToolItem[] = [
    { key: "showSplit", label: t("showSplit", lang) },
    { key: "showSftp", label: t("showSftp", lang) },
    { key: "showTunnels", label: "Tunnels" },
    { key: "showSnippets", label: "Snippets" },
    { key: "showSearch", label: lang === "de" ? "Suche" : "Search" },
    { key: "showNotes", label: "Notes" }
  ]

  return (
    <SettingCard title={t("terminal", lang)} desc={ui.terminalDesc}>
      <FieldRow label={`${t("fontSize", lang)} (px)`} desc={ui.fontSizeDesc} first>
        <input
          type="number"
          value={settings.fontSize}
          onChange={(e) => {
            const next = clampNumber(parseInt(e.target.value || "14", 10), 8, 48, 14)
            setSettings({ ...settings, fontSize: next })
          }}
          style={uniformNumberInputStyle}
        />
      </FieldRow>

      <FieldRow label={t("scrollback", lang)} desc={ui.scrollbackDesc}>
        <input
          type="number"
          value={settings.scrollback}
          onChange={(e) => {
            const next = clampNumber(parseInt(e.target.value || "10000", 10), 100, 200000, 10000)
            setSettings({ ...settings, scrollback: next })
          }}
          style={uniformNumberInputStyle}
        />
      </FieldRow>

      <FieldRow label={t("cursorStyle", lang)} desc={ui.cursorStyleDesc}>
        <select
          value={settings.cursorStyle}
          onChange={(e) => setSettings({ ...settings, cursorStyle: e.target.value as AppSettings["cursorStyle"] })}
          style={uniformSelectStyle}
        >
          <option value="block">{t("block", lang)}</option>
          <option value="bar">{t("bar", lang)}</option>
          <option value="underline">{t("underline", lang)}</option>
        </select>
      </FieldRow>

      <FieldRow label={t("cursorBlink", lang)} desc={ui.cursorBlinkDesc}>
        <Toggle
          checked={Boolean(settings.cursorBlink)}
          onChange={(next) => setSettings({ ...settings, cursorBlink: next })}
        />
      </FieldRow>

      <div style={{ marginTop: 12 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginBottom: 8
          }}
        >
          {ui.terminalToolsTitle}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {toolItems.map((tool) => (
            <div
              key={tool.key}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: 12,
                background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
                padding: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)" }}>
                {tool.label}
              </div>
              <Toggle
                checked={settings[tool.key] !== false}
                onChange={(next) => setSettings({ ...settings, [tool.key]: next })}
              />
            </div>
          ))}
        </div>
      </div>
    </SettingCard>
  )
}
