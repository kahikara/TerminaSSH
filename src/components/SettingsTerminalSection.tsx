import { t } from "../lib/i18n"
import { SettingCard, FieldRow, Toggle } from "./SettingsUi"

type Props = {
  lang: string
  ui: any
  settings: any
  setSettings: (next: any) => void
  uniformNumberInputStyle: React.CSSProperties
  uniformSelectStyle: React.CSSProperties
}

export default function SettingsTerminalSection({
  lang,
  ui,
  settings,
  setSettings,
  uniformNumberInputStyle,
  uniformSelectStyle
}: Props) {
  return (
    <SettingCard title={t("terminal", lang)} desc={ui.terminalDesc}>
      <FieldRow label={`${t("fontSize", lang)} (px)`} desc={ui.fontSizeDesc} first>
        <input
          type="number"
          value={settings.fontSize}
          onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value || "14", 10) })}
          style={uniformNumberInputStyle}
        />
      </FieldRow>

      <FieldRow label={t("scrollback", lang)} desc={ui.scrollbackDesc}>
        <input
          type="number"
          value={settings.scrollback}
          onChange={(e) => setSettings({ ...settings, scrollback: parseInt(e.target.value || "10000", 10) })}
          style={uniformNumberInputStyle}
        />
      </FieldRow>

      <FieldRow label={t("cursorStyle", lang)} desc={ui.cursorStyleDesc}>
        <select
          value={settings.cursorStyle}
          onChange={(e) => setSettings({ ...settings, cursorStyle: e.target.value })}
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
    </SettingCard>
  )
}
