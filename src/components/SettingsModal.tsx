import { useState, useEffect } from "react"
import type { AppSettings, SettingsSectionId, StoredSshKey } from "../lib/types"
import { t } from "../lib/i18n"
import { modalShell, iconButton, navButtonBase, cardStyle, uniformSelectStyle, uniformNumberInputStyle, actionBtnStyle, primaryBtnStyle } from "./SettingsStyles"
import SettingsSidebar from "./SettingsSidebar"
import SettingsModalHeader from "./SettingsModalHeader"
import SettingsKeysSection from "./SettingsKeysSection"
import SettingsGeneralSection from "./SettingsGeneralSection"
import SettingsStatusBarSection from "./SettingsStatusBarSection"
import SettingsTerminalSection from "./SettingsTerminalSection"
import SettingsSftpSection from "./SettingsSftpSection"
import SettingsBackupSection from "./SettingsBackupSection"
import SettingsAboutSection from "./SettingsAboutSection"
import { getSettingsNavItems } from "./settingsNav"
import { getSettingsUi } from "./settingsText"
import { loadSshKeys, promptGenerateSshKey, importExistingSshKey, copySshPublicKey, confirmDeleteSshKey } from "../lib/settingsKeys"
import { openExternalLink, copyToClipboard } from "../lib/settingsHelpers"
import { handleExportPlainConfig, handleExportEncryptedConfig, handleImportConfig } from "../lib/settingsBackup"

type SettingsModalProps = {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  showToast: any
  showDialog: any
  globalDialogOpen?: boolean
}

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  setSettings,
  showToast,
  showDialog
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsSectionId>("general")
  const [keys, setKeys] = useState<StoredSshKey[]>([])

  const lang = settings?.lang || "en"

  const loadKeys = async () => {
    await loadSshKeys({ setKeys })
  }

  const ui = getSettingsUi(lang)

  useEffect(() => {
    if (isOpen && activeTab === "keys") {
      void loadKeys()
    }
  }, [isOpen, activeTab])

  if (!isOpen) return null

  const navItems = getSettingsNavItems(lang, ui)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={modalShell}
      >
        <SettingsModalHeader
          title={ui.settingsTitle}
          subtitle=""
          onClose={onClose}
          closeLabel={t("close", lang)}
          iconButton={iconButton}
        />

        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <SettingsSidebar
            navItems={navItems}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            navButtonBase={navButtonBase}
          />

          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              overflowY: "auto",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              background: "color-mix(in srgb, var(--bg-app) 96%, black)"
            }}
          >
            {activeTab === "general" && (
              <SettingsGeneralSection
                lang={lang}
                ui={ui}
                settings={settings}
                setSettings={setSettings}
                uniformSelectStyle={uniformSelectStyle}
              />
            )}

            {activeTab === "statusbar" && (
              <SettingsStatusBarSection
                ui={ui}
                settings={settings}
                setSettings={setSettings}
              />
            )}

            {activeTab === "terminal" && (
              <SettingsTerminalSection
                lang={lang}
                ui={ui}
                settings={settings}
                setSettings={setSettings}
                uniformNumberInputStyle={uniformNumberInputStyle}
                uniformSelectStyle={uniformSelectStyle}
              />
            )}

            {activeTab === "sftp" && (
              <SettingsSftpSection
                lang={lang}
                ui={ui}
                settings={settings}
                setSettings={setSettings}
                uniformSelectStyle={uniformSelectStyle}
              />
            )}

            {activeTab === "keys" && (
              <SettingsKeysSection
                lang={lang}
                ui={ui}
                keys={keys}
                loadKeys={loadKeys}
                showDialog={showDialog}
                showToast={showToast}
                primaryBtnStyle={primaryBtnStyle}
                actionBtnStyle={actionBtnStyle}
                promptGenerateSshKey={promptGenerateSshKey}
                importExistingSshKey={importExistingSshKey}
                copySshPublicKey={copySshPublicKey}
                confirmDeleteSshKey={confirmDeleteSshKey}
              />
            )}

            {activeTab === "backup" && (
              <SettingsBackupSection
                lang={lang}
                ui={ui}
                cardStyle={cardStyle}
                settings={settings}
                setSettings={setSettings}
                showToast={showToast}
                showDialog={showDialog}
                handleExportPlainConfig={handleExportPlainConfig}
                handleExportEncryptedConfig={handleExportEncryptedConfig}
                handleImportConfig={handleImportConfig}
              />
            )}

            {activeTab === "about" && (
              <SettingsAboutSection
                ui={ui}
                showToast={showToast}
                openExternalLink={openExternalLink}
                copyToClipboard={copyToClipboard}
                primaryBtnStyle={primaryBtnStyle}
                actionBtnStyle={actionBtnStyle}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
