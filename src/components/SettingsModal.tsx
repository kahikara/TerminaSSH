import { useState, useEffect, useMemo } from "react";
import {
  X,
  Terminal as TermIcon,
  Folder,
  Key,
  Plus,
  Upload,
  Trash2,
  Copy,
  Save,
  Download as DownloadIcon,
  Database,
  Info,
  Globe,
  MonitorCog
} from "lucide-react";
import { t } from "../lib/i18n";
import { modalShell, iconButton, navButtonBase, cardStyle, uniformSelectStyle, uniformNumberInputStyle, actionBtnStyle, primaryBtnStyle } from "./SettingsStyles";
import { SettingCard, FieldRow, Toggle } from "./SettingsUi";
import SettingsAboutCard from "./SettingsAboutCard";
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


  const ui = useMemo(() => {
    if (lang === "de") {
      return {
        subtitle: "Einstellungen, Verhalten und Projektinfos an einem Ort.",
        general: "Allgemein",
        generalDesc: "Sprache, Theme und grundlegende App Optionen.",
        interface: "Oberfläche",
        interfaceDesc: "Steuere die aktuell verfügbaren Werkzeuge in der Terminal Leiste.",
        dashboardTitle: "Dashboard",
        dashboardDesc: "Lege fest, welche Bereiche auf der Startseite sichtbar sind.",
        showDashboardQuickConnectLabel: "Quick Connect anzeigen",
        showDashboardQuickConnectDesc: "Blendet die Quick Connect Box auf der Startseite ein oder aus.",
        showDashboardWorkflowLabel: "Workflow Übersicht anzeigen",
        showDashboardWorkflowDesc: "Zeigt die große Workflow Box mit Local Terminal und den Kennzahlen.",
        showDashboardActiveSessionsLabel: "Active Sessions anzeigen",
        showDashboardActiveSessionsDesc: "Blendet die Box mit den aktuell offenen Sessions ein oder aus.",
        showDashboardRecentConnectionsLabel: "Recent Connections anzeigen",
        showDashboardRecentConnectionsDesc: "Blendet die Box mit den zuletzt verwendeten Verbindungen ein oder aus.",
        statusBar: "Status Bar",
        statusBarDesc: "Lege fest, welche Infos unten im Terminal sichtbar sind.",
        terminalDesc: "Darstellung und Verhalten des Terminals.",
        showStatusBarLabel: "Status Bar anzeigen",
        showStatusBarLabelDesc: "Blendet die Leiste am unteren Rand des Terminals ein oder aus.",
        showStatusBarSessionLabel: "Session Zeit anzeigen",
        showStatusBarSessionLabelDesc: "Zeigt links die Laufzeit der aktuellen Session.",
        showStatusBarTunnelLabel: "Tunnel Status anzeigen",
        showStatusBarTunnelLabelDesc: "Zeigt mittig aktive Tunnel nur dann, wenn wirklich einer läuft.",
        showStatusBarLoadLabel: "Load anzeigen",
        showStatusBarLoadLabelDesc: "Zeigt rechts die Systemlast, sobald diese Info verfügbar ist.",
        showStatusBarRamLabel: "RAM anzeigen",
        showStatusBarRamLabelDesc: "Zeigt rechts die RAM Nutzung, sobald diese Info verfügbar ist.",
        sftpDesc: "Standardverhalten für den SFTP Browser.",
        keysDesc: "Verwalte deine gespeicherten SSH Schlüssel.",
        backupDescTitle: "Sichert Einstellungen, Verbindungen, Snippets und SSH Schlüssel.",
        about: "About",
        aboutDesc: "Projektinfo, kurzer Überblick und Support Link.",
        appLanguageDesc: "Sprache der Oberfläche.",
        themeDesc: "Aktuelles Farbschema der App.",
        closeToTrayLabel: "In Tray schließen",
        closeToTrayDesc: "Fenster beim Schließen ausblenden. Beenden über den Tray.",
        terminalToolsDesc: "Aktuell werden nur wirklich funktionierende Werkzeuge angezeigt.",
        fontSizeDesc: "Schriftgröße im Terminal.",
        scrollbackDesc: "Wie viele Zeilen im Verlauf gehalten werden.",
        cursorStyleDesc: "Form des Terminal Cursors.",
        cursorBlinkDesc: "Cursor blinkt im Terminal.",
        showHiddenDesc: "Versteckte Dateien standardmäßig anzeigen.",
        sortOrderDesc: "Standard Sortierung im SFTP Browser.",
        noKeys: "Keine Schlüssel vorhanden.",
        noKeysHint: "Erzeuge einen neuen Schlüssel oder importiere einen vorhandenen.",
        generated: "Schlüssel generiert!",
        imported: "Schlüssel importiert!",
        exported: "Backup exportiert!",
        importedBackup: "Backup importiert!",
        wrongPassword: "Falsches Passwort!",
        importedLabel: "Importiert",
        toolsSection: "Werkzeuge",
        projectTitle: "Termina SSH",
        projectText:
          "Termina SSH ist ein moderner Desktop SSH Client mit Fokus auf einen ruhigen Workflow, schnelle Sessions, integrierten SFTP Zugriff und einen eingebauten Editor. Das Ziel ist ein Daily Driver, der sich stabil, schnell und angenehm anfühlt.",
        supportTitle: "Support",
        supportText: "Wenn dir das Projekt gefällt und du die Weiterentwicklung unterstützen willst, kannst du mir auf Ko fi einen Kaffee spendieren.",
        openKofi: "Ko fi öffnen",
        copyLink: "Link kopieren",
        copiedLink: "Link kopiert!",
        versionLabel: "Projektstatus",
        versionValue: "UI und Workflow werden aktiv verfeinert.",
        settingsTitle: t("settings", lang)
      };
    }

    return {
      subtitle: "Settings, behavior and project info in one place.",
      general: "General",
      generalDesc: "Language, theme and core app options.",
      interface: "Interface",
      interfaceDesc: "Control the tools that are currently available in the terminal header.",
      dashboardTitle: "Dashboard",
      dashboardDesc: "Choose which sections are visible on the start page.",
      showDashboardQuickConnectLabel: "Show Quick Connect",
      showDashboardQuickConnectDesc: "Shows or hides the Quick Connect box on the start page.",
      showDashboardWorkflowLabel: "Show workflow overview",
      showDashboardWorkflowDesc: "Shows the large workflow box with Local Terminal and the quick counters.",
      showDashboardActiveSessionsLabel: "Show Active Sessions",
      showDashboardActiveSessionsDesc: "Shows or hides the card with the currently open sessions.",
      showDashboardRecentConnectionsLabel: "Show Recent Connections",
      showDashboardRecentConnectionsDesc: "Shows or hides the card with the recently used connections.",
      statusBar: "Status Bar",
      statusBarDesc: "Choose which details are visible at the bottom of the terminal.",
      terminalDesc: "Appearance and behavior of the terminal.",
      showStatusBarLabel: "Show status bar",
      showStatusBarLabelDesc: "Shows or hides the bar at the bottom of the terminal.",
      showStatusBarSessionLabel: "Show session timer",
      showStatusBarSessionLabelDesc: "Shows the current session duration on the left.",
      showStatusBarTunnelLabel: "Show tunnel status",
      showStatusBarTunnelLabelDesc: "Shows active tunnel info in the center only when a tunnel is really active.",
      showStatusBarLoadLabel: "Show load",
      showStatusBarLoadLabelDesc: "Shows system load on the right as soon as that info is available.",
      showStatusBarRamLabel: "Show RAM",
      showStatusBarRamLabelDesc: "Shows RAM usage on the right as soon as that info is available.",
      sftpDesc: "Default behavior for the SFTP browser.",
      keysDesc: "Manage your stored SSH keys.",
      backupDescTitle: "Backs up settings, connections, snippets and SSH keys.",
      about: "About",
      aboutDesc: "Project info, short overview and support link.",
      appLanguageDesc: "Language of the interface.",
      themeDesc: "Current color theme of the app.",
      closeToTrayLabel: "Close to tray",
      closeToTrayDesc: "Hide window on close. Quit from tray.",
      terminalToolsDesc: "Only tools that are already fully working are shown here right now.",
      fontSizeDesc: "Terminal font size.",
      scrollbackDesc: "How many lines are kept in history.",
      cursorStyleDesc: "Shape of the terminal cursor.",
      cursorBlinkDesc: "Blinking terminal cursor.",
      showHiddenDesc: "Show hidden files by default.",
      sortOrderDesc: "Default sorting in the SFTP browser.",
      noKeys: "No keys available.",
      noKeysHint: "Generate a new key or import an existing one.",
      generated: "Key generated!",
      imported: "Key imported!",
      exported: "Backup exported!",
      importedBackup: "Backup imported!",
      wrongPassword: "Wrong password!",
      importedLabel: "Imported",
      toolsSection: "Tools",
      projectTitle: "Termina SSH",
      projectText:
        "Termina SSH is a modern desktop SSH client focused on a calm workflow, fast sessions, integrated SFTP access and a built in editor. The goal is a daily driver that feels stable, fast and pleasant to use.",
      supportTitle: "Support",
      supportText: "If you enjoy the project and want to support further development, you can buy me a coffee on Ko fi.",
      openKofi: "Open Ko fi",
      copyLink: "Copy link",
      copiedLink: "Link copied!",
      versionLabel: "Project status",
      versionValue: "UI and workflow are being actively refined.",
      settingsTitle: t("settings", lang)
    };
  }, [lang]);

  useEffect(() => {
    if (isOpen && activeTab === "keys") {
      void loadKeys();
    }
  }, [isOpen, activeTab]);

          
  if (!isOpen) return null;

  const navItems = [
    { id: "general", icon: Globe, label: ui.general },
    { id: "statusbar", icon: MonitorCog, label: ui.statusBar },
    { id: "terminal", icon: TermIcon, label: t("terminal", lang) },
    { id: "sftp", icon: Folder, label: t("sftp", lang) },
    { id: "keys", icon: Key, label: t("keyManager", lang) },
    { id: "backup", icon: Database, label: t("backup", lang) },
    { id: "about", icon: Info, label: ui.about }
  ];

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
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 12
                    }}
                  >
                    <button
                      onClick={() => handleExportPlainConfig({ settings, showToast, ui })}
                      style={{
                        ...cardStyle,
                        background: "var(--bg-app)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        minHeight: 140
                      }}
                    >
                      <Save size={26} style={{ color: "var(--accent)" }} />
                      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>
                        {lang === "de" ? "Ohne Passwort exportieren" : "Export without password"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
                        {lang === "de"
                          ? "Speichert das Backup als lesbare JSON Datei."
                          : "Saves the backup as a readable JSON file."}
                      </div>
                    </button>

                    <button
                      onClick={() => handleExportEncryptedConfig({ settings, showToast, showDialog, ui, lang })}
                      style={{
                        ...cardStyle,
                        background: "var(--bg-app)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        minHeight: 140
                      }}
                    >
                      <Database size={26} style={{ color: "var(--accent)" }} />
                      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>
                        {lang === "de" ? "Mit Passwort exportieren" : "Export with password"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
                        {lang === "de"
                          ? "Schützt das Backup mit AES 256 und Passwort."
                          : "Protects the backup with AES 256 and a password."}
                      </div>
                    </button>

                    <button
                      onClick={() => handleImportConfig({ settings, setSettings, showToast, showDialog, ui, lang })}
                      style={{
                        ...cardStyle,
                        background: "var(--bg-app)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        minHeight: 140
                      }}
                    >
                      <DownloadIcon size={26} style={{ color: "var(--accent)" }} />
                      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>
                        {t("importConfig", lang)}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
                        {lang === "de"
                          ? "Importiert normale JSON Backups oder verschlüsselte Backups."
                          : "Imports plain JSON backups or encrypted backups."}
                      </div>
                    </button>
                  </div>
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
