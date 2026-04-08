import { t } from "../lib/i18n"
import type { AppSettings } from "../lib/types"
import { SettingCard, FieldRow, Toggle } from "./SettingsUi"

type Props = {
  lang: string
  ui: any
  settings: AppSettings
  setSettings: (next: AppSettings) => void
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
            onChange={(e) => setSettings({ ...settings, theme: e.target.value as AppSettings["theme"] })}
            style={uniformSelectStyle}
          >
            <option value="catppuccin">Catppuccin</option>
            <option value="nord">Nord</option>
            <option value="pitch-black">Pitch Black</option>
            <option value="light">Light</option>
          </select>
        </FieldRow>

        <FieldRow label={ui.closeToTrayLabel} desc={ui.closeToTrayDesc}>
          <Toggle
            checked={Boolean(settings.closeToTray)}
            onChange={(next) => setSettings({ ...settings, closeToTray: next })}
          />
        </FieldRow>
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
