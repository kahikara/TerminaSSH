import { t } from "../lib/i18n"
import type { AppSettings } from "../lib/types"
import { SettingCard, FieldRow, Toggle } from "./SettingsUi"

type Props = {
  lang: string
  ui: any
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  uniformNumberInputStyle: React.CSSProperties
  uniformSelectStyle: React.CSSProperties
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

      <FieldRow label={ui.terminalRightClickLabel} desc={ui.terminalRightClickDesc}>
        <select
          value={settings.terminalRightClickMode || "clipboard"}
          onChange={(e) =>
            setSettings({
              ...settings,
              terminalRightClickMode: e.target.value as AppSettings["terminalRightClickMode"]
            })
          }
          style={uniformSelectStyle}
        >
          <option value="clipboard">{ui.terminalRightClickClipboard}</option>
          <option value="contextMenu">{ui.terminalRightClickContextMenu}</option>
        </select>
      </FieldRow>
    </SettingCard>
  )
}
