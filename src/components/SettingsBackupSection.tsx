import { t } from "../lib/i18n"
import type { AppSettings } from "../lib/types"
import { SettingCard } from "./SettingsUi"
import SettingsBackupCards from "./SettingsBackupCards"

type Props = {
  lang: string
  ui: any
  cardStyle: React.CSSProperties
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  showToast: any
  showDialog: any
  handleExportPlainConfig: any
  handleExportEncryptedConfig: any
  handleImportConfig: any
}

export default function SettingsBackupSection({
  lang,
  ui,
  cardStyle,
  settings,
  setSettings,
  showToast,
  showDialog,
  handleExportPlainConfig,
  handleExportEncryptedConfig,
  handleImportConfig
}: Props) {
  return (
    <SettingCard title={t("backup", lang)} desc={ui.backupDescTitle}>
      <SettingsBackupCards
        lang={lang}
        cardStyle={cardStyle}
        onExportPlain={() => handleExportPlainConfig({ settings, showToast, ui })}
        onExportEncrypted={() => handleExportEncryptedConfig({ settings, showToast, showDialog, ui, lang })}
        onImport={() => handleImportConfig({ settings, setSettings, showToast, showDialog, ui, lang })}
        importLabel={t("importConfig", lang)}
      />
    </SettingCard>
  )
}
