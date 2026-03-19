import { useState, useEffect } from "react";
import {
  X,
  Plus,
  Upload,
  Trash2,
  Copy
} from "lucide-react";
import { t } from "../lib/i18n";
import { modalShell, iconButton, navButtonBase, cardStyle, uniformSelectStyle, uniformNumberInputStyle, actionBtnStyle, primaryBtnStyle } from "./SettingsStyles";
import { SettingCard, FieldRow, Toggle } from "./SettingsUi";
import SettingsAboutCard from "./SettingsAboutCard";
import SettingsBackupCards from "./SettingsBackupCards";
import { getSettingsNavItems } from "./settingsNav";
import { getSettingsUi } from "./settingsText";
import { loadSshKeys, promptGenerateSshKey, importExistingSshKey, copySshPublicKey, confirmDeleteSshKey } from "../lib/settingsKeys";
import { openExternalLink, copyToClipboard } from "../lib/settingsHelpers";
import { handleExportPlainConfig, handleExportEncryptedConfig, handleImportConfig } from "../lib/settingsBackup";

export default function SettingsModal({ isOpen, onClose, settings, setSettings, showToast, showDialog }: any) {
  const [activeTab, setActiveTab] = useState("general");
  const [keys, setKeys] = useState<any[]>([]);

  const lang = settings?.lang || "en";

  const loadKeys = async () => {
    await loadSshKeys({ setKeys });
  };
  const ui = getSettingsUi(lang);

  useEffect(() => {
    if (isOpen && activeTab === "keys") {
      void loadKeys();
    }
  }, [isOpen, activeTab]);

          
  if (!isOpen) return null;
  const navItems = getSettingsNavItems(lang, ui);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalShell}>
        <div
          style={{
            height: 54,
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
            background: "color-mix(in srgb, var(--bg-sidebar) 92%, var(--bg-app))",
            flexShrink: 0
          }}
        >
          <div>
            <div style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 700, color: "var(--text-main)" }}>{ui.settingsTitle}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{ui.subtitle}</div>
          </div>

          <button onClick={onClose} style={iconButton} title={t("close", lang)}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <div
            style={{
              width: 216,
              borderRight: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
              background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))",
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              overflowY: "auto",
              flexShrink: 0
            }}
          >

            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  style={{
                    ...navButtonBase,
                    background: active ? "var(--bg-hover)" : "transparent",
                    color: active ? "var(--text-main)" : "var(--text-muted)",
                    border: active ? "1px solid var(--border-subtle)" : "1px solid transparent"
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: active ? "var(--bg-app)" : "transparent",
                      border: active ? "1px solid var(--border-subtle)" : "1px solid transparent",
                      flexShrink: 0
                    }}
                  >
                    <Icon size={15} />
                  </span>
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                </button>
              );
            })}
          </div>

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
            )}

            {activeTab === "statusbar" && (
              <>
                <SettingCard title={ui.statusBar} desc={ui.statusBarDesc}>
                  <FieldRow label={ui.showStatusBarLabel} desc={ui.showStatusBarLabelDesc} first>
                    <Toggle
                      checked={settings.showStatusBar !== false}
                      onChange={(next) => setSettings({ ...settings, showStatusBar: next })}
                    />
                  </FieldRow>

                  <FieldRow label={ui.showStatusBarSessionLabel} desc={ui.showStatusBarSessionLabelDesc}>
                    <Toggle
                      checked={settings.showStatusBarSession !== false}
                      onChange={(next) => setSettings({ ...settings, showStatusBarSession: next })}
                    />
                  </FieldRow>

                  <FieldRow label={ui.showStatusBarTunnelLabel} desc={ui.showStatusBarTunnelLabelDesc}>
                    <Toggle
                      checked={settings.showStatusBarTunnel !== false}
                      onChange={(next) => setSettings({ ...settings, showStatusBarTunnel: next })}
                    />
                  </FieldRow>

                  <FieldRow label={ui.showStatusBarLoadLabel} desc={ui.showStatusBarLoadLabelDesc}>
                    <Toggle
                      checked={settings.showStatusBarLoad !== false}
                      onChange={(next) => setSettings({ ...settings, showStatusBarLoad: next })}
                    />
                  </FieldRow>

                  <FieldRow label={ui.showStatusBarRamLabel} desc={ui.showStatusBarRamLabelDesc}>
                    <Toggle
                      checked={settings.showStatusBarRam !== false}
                      onChange={(next) => setSettings({ ...settings, showStatusBarRam: next })}
                    />
                  </FieldRow>
                </SettingCard>
              </>
            )}

            {activeTab === "terminal" && (
              <>
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
              </>
            )}

            {activeTab === "sftp" && (
              <>
                <SettingCard title={t("sftp", lang)} desc={ui.sftpDesc}>
                  <FieldRow label={t("showHidden", lang)} desc={ui.showHiddenDesc} first>
                    <Toggle
                      checked={Boolean(settings.sftpHidden)}
                      onChange={(next) => setSettings({ ...settings, sftpHidden: next })}
                    />
                  </FieldRow>

                  <FieldRow label={t("sortOrder", lang)} desc={ui.sortOrderDesc}>
                    <select
                      value={settings.sftpSort}
                      onChange={(e) => setSettings({ ...settings, sftpSort: e.target.value })}
                      style={uniformSelectStyle}
                    >
                      <option value="folders">{t("foldersFirst", lang)}</option>
                      <option value="name">Name</option>
                      <option value="size">{lang === "de" ? "Größe" : "Size"}</option>
                      <option value="type">{lang === "de" ? "Typ" : "Type"}</option>
                    </select>
                  </FieldRow>
                </SettingCard>
              </>
            )}

            {activeTab === "keys" && (
              <>
                <SettingCard title={t("keyManager", lang)} desc={ui.keysDesc}>
                  <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                    <button
                      onClick={() => promptGenerateSshKey({ lang, showDialog, showToast, ui, loadKeys })}
                      style={primaryBtnStyle}
                    >
                      <Plus size={15} />
                      {t("generateKey", lang)}
                    </button>

                    <button
                      onClick={() => void importExistingSshKey({ lang, showToast, ui, loadKeys })}
                      style={actionBtnStyle}
                    >
                      <Upload size={15} />
                      {t("importKey", lang)}
                    </button>
                  </div>

                  {keys.length === 0 ? (
                    <div
                      style={{
                        border: "1px dashed var(--border-subtle)",
                        borderRadius: 15,
                        background: "var(--bg-app)",
                        padding: 20,
                        textAlign: "center"
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{ui.noKeys}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.45 }}>
                        {ui.noKeysHint}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, opacity: 0.85 }}>
                        Imported keys currently expect a valid existing key file path.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "row", gap: 10 }}>
                      {keys.map((k: any) => (
                        <div
                          key={k.id}
                          style={{
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 15,
                            background: "var(--bg-app)",
                            padding: 14,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 14
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{k.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                              {k.key_type} • {k.fingerprint}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button
                              onClick={() => void copySshPublicKey({ publicKey: k.public_key, lang, showToast })}
                              style={actionBtnStyle}
                              title={t("copy", lang)}
                            >
                              <Copy size={14} />
                            </button>

                            <button
                              onClick={() => confirmDeleteSshKey({ id: k.id, lang, showDialog, showToast, loadKeys })}
                              style={actionBtnStyle}
                              title={t("delete", lang)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SettingCard>
              </>
            )}

            {activeTab === "backup" && (
              <>
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
              </>
            )}
            {activeTab === "about" && (
              <>
                <SettingCard title={ui.projectTitle} desc={ui.aboutDesc}>
                  <SettingsAboutCard
                    ui={ui}
                    showToast={showToast}
                    openExternalLink={openExternalLink}
                    copyToClipboard={copyToClipboard}
                    primaryBtnStyle={primaryBtnStyle}
                    actionBtnStyle={actionBtnStyle}
                  />
                </SettingCard>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
