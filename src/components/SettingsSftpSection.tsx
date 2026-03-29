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

function normalizeSftpSort(value: AppSettings["sftpSort"] | string | undefined): AppSettings["sftpSort"] {
  if (value === "az" || value === "za") return "name"
  if (value === "folders" || value === "name" || value === "size" || value === "type") return value
  return "folders"
}

export default function SettingsSftpSection({
  lang,
  ui,
  settings,
  setSettings,
  uniformSelectStyle
}: Props) {
  return (
    <SettingCard title={t("sftp", lang)} desc={ui.sftpDesc}>
      <FieldRow label={t("showHidden", lang)} desc={ui.showHiddenDesc} first>
        <Toggle
          checked={Boolean(settings.sftpHidden)}
          onChange={(next) => setSettings({ ...settings, sftpHidden: next })}
        />
      </FieldRow>

      <FieldRow label={t("sortOrder", lang)} desc={ui.sortOrderDesc}>
        <select
          value={normalizeSftpSort(settings.sftpSort)}
          onChange={(e) => setSettings({ ...settings, sftpSort: normalizeSftpSort(e.target.value) })}
          style={uniformSelectStyle}
        >
          <option value="folders">{t("foldersFirst", lang)}</option>
          <option value="name">Name</option>
          <option value="size">{lang === "de" ? "Größe" : "Size"}</option>
          <option value="type">{lang === "de" ? "Typ" : "Type"}</option>
        </select>
      </FieldRow>
    </SettingCard>
  )
}
