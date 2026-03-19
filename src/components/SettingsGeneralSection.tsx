import { t } from "../lib/i18n"
import { SettingCard, FieldRow, Toggle } from "./SettingsUi"

type Props = {
  lang: string
  ui: any
  settings: any
  setSettings: (next: any) => void
  uniformSelectStyle: React.CSSProperties
}

export default function SettingsGeneralSection({
  lang,
  ui,
  settings,
  setSettings,
  uniformSelectStyle
}: Props) {
  return (
    <>
      <SettingCard title={ui.general} desc={ui.generalDesc}>
        <FieldRow label={t("language", lang)} desc={ui.appLanguageDesc} first>
          <select
            value={settings.lang}
            onChange={(e) => setSettings({ ...settings, lang: e.target.value })}
            style={uniformSelectStyle}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </FieldRow>

        <FieldRow label={t("theme", lang)} desc={ui.themeDesc}>
          <select
            value={settings.theme}
            onChange={(e) => setSettings({ ...settings, theme: e.target.value })}
            style={uniformSelectStyle}
          >
            <option value="catppuccin">Catppuccin</option>
            <option value="nord">Nord</option>
            <option value="pitch-black">Pitch Black</option>
          </select>
        </FieldRow>

        <FieldRow label={ui.closeToTrayLabel} desc={ui.closeToTrayDesc}>
          <Toggle
            checked={Boolean(settings.closeToTray)}
            onChange={(next) => setSettings({ ...settings, closeToTray: next })}
          />
        </FieldRow>
      </SettingCard>

      <SettingCard title={ui.interface} desc={ui.interfaceDesc}>
        <div style={{ marginTop: 2 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
            {ui.toolsSection}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { key: "showSplit", label: t("showSplit", lang) },
              { key: "showSftp", label: t("showSftp", lang) },
              { key: "showTunnels", label: "Tunnels" },
              { key: "showSnippets", label: "Snippets" },
              { key: "showSearch", label: lang === "de" ? "Suche" : "Search" },
              { key: "showNotes", label: "Notes" }
            ].map((tool) => (
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

          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
            {ui.terminalToolsDesc}
          </div>
        </div>
      </SettingCard>

      <SettingCard title={ui.dashboardTitle} desc={ui.dashboardDesc}>
        <FieldRow label={ui.showDashboardQuickConnectLabel} desc={ui.showDashboardQuickConnectDesc} first>
          <Toggle
            checked={settings.showDashboardQuickConnect !== false}
            onChange={(next) => setSettings({ ...settings, showDashboardQuickConnect: next })}
          />
        </FieldRow>

        <FieldRow label={ui.showDashboardWorkflowLabel} desc={ui.showDashboardWorkflowDesc}>
          <Toggle
            checked={settings.showDashboardWorkflow !== false}
            onChange={(next) => setSettings({ ...settings, showDashboardWorkflow: next })}
          />
        </FieldRow>

        <FieldRow label={ui.showDashboardActiveSessionsLabel} desc={ui.showDashboardActiveSessionsDesc}>
          <Toggle
            checked={settings.showDashboardActiveSessions !== false}
            onChange={(next) => setSettings({ ...settings, showDashboardActiveSessions: next })}
          />
        </FieldRow>

        <FieldRow label={ui.showDashboardRecentConnectionsLabel} desc={ui.showDashboardRecentConnectionsDesc}>
          <Toggle
            checked={settings.showDashboardRecentConnections !== false}
            onChange={(next) => setSettings({ ...settings, showDashboardRecentConnections: next })}
          />
        </FieldRow>
      </SettingCard>
    </>
  )
}
