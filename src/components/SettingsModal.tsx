import React from "react";
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
  MonitorCog,
  Heart
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { t } from "../lib/i18n";

async function encryptData(text: string, password: string) {
  const enc = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  const bundle = new Uint8Array(salt.length + iv.length + cipher.byteLength);
  bundle.set(salt, 0);
  bundle.set(iv, salt.length);
  bundle.set(new Uint8Array(cipher), salt.length + iv.length);
  let binary = "";
  for (let i = 0; i < bundle.length; i++) binary += String.fromCharCode(bundle[i]);
  return btoa(binary);
}

async function decryptData(base64: string, password: string) {
  const binary = atob(base64);
  const bundle = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bundle[i] = binary.charCodeAt(i);
  const salt = bundle.slice(0, 16);
  const iv = bundle.slice(16, 28);
  const cipher = bundle.slice(28);
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plain = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

async function openExternalLink(url: string) {
  try {
    await invoke("open_external_url", { url });
    return true;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string) {
  try {
    await invoke("copy_text_to_clipboard", { text });
    return true;
  } catch {
    return false;
  }
}

const modalShell: React.CSSProperties = {
  width: 860,
  height: 580,
  maxWidth: "calc(100vw - 40px)",
  maxHeight: "calc(100vh - 40px)",
  borderRadius: 16,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-app)",
  border: "1px solid var(--border-subtle)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.38)"
};

const iconButton: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-app)",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease"
};

const navButtonBase: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 10px",
  borderRadius: 12,
  fontSize: 13,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  transition: "all 140ms ease"
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--bg-sidebar) 82%, var(--bg-app))",
  borderRadius: 14,
  padding: 14
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 0",
  borderTop: "1px solid color-mix(in srgb, var(--border-subtle) 65%, transparent)"
};

const inputStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  color: "var(--text-main)",
  outline: "none",
  fontSize: 13
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 156,
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  backgroundImage: "linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%)",
  backgroundPosition: "calc(100% - 18px) calc(50% - 2px), calc(100% - 12px) calc(50% - 2px)",
  backgroundSize: "6px 6px, 6px 6px",
  backgroundRepeat: "no-repeat",
  paddingRight: 32
};

const uniformSelectStyle: React.CSSProperties = {
  ...selectStyle
};

const uniformNumberInputStyle: React.CSSProperties = {
  ...inputStyle,
  width: 156,
  textAlign: "center"
};

const actionBtnStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
  color: "var(--text-main)",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  transition: "background 140ms ease, border-color 140ms ease, opacity 140ms ease"
};

const primaryBtnStyle: React.CSSProperties = {
  ...actionBtnStyle,
  background: "var(--accent)",
  color: "black",
  border: "1px solid transparent"
};

function SettingCard({
  title,
  desc,
  children
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 700, color: "var(--text-main)" }}>{title}</div>
        {desc ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>
            {desc}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function FieldRow({
  label,
  desc,
  children,
  first = false
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div style={{ ...fieldRowStyle, borderTop: first ? "none" : fieldRowStyle.borderTop }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, lineHeight: 1.25, fontWeight: 600, color: "var(--text-main)" }}>{label}</div>
        {desc ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
        ) : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: "1px solid var(--border-subtle)",
        background: checked ? "var(--accent)" : "var(--bg-app)",
        position: "relative",
        cursor: "pointer",
        transition: "all 140ms ease"
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: checked ? "black" : "var(--text-main)",
          transition: "left 140ms ease, background 140ms ease"
        }}
      />
    </button>
  );
}

export default function SettingsModal({ isOpen, onClose, settings, setSettings, showToast, showDialog }: any) {
  const [activeTab, setActiveTab] = useState("general");
  const [keys, setKeys] = useState<any[]>([]);

  const lang = settings?.lang || "en";

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

  const loadKeys = async () => {
    try {
      setKeys(await invoke("get_ssh_keys"));
    } catch (e) {}
  };

  useEffect(() => {
    if (isOpen && activeTab === "keys") loadKeys();
  }, [isOpen, activeTab]);

  async function buildExportPayload() {
    const conns = await invoke("get_connections");
    const snippets = await invoke("get_snippets");
    const sshKeys = await invoke("get_ssh_keys");

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      settings,
      connections: conns,
      snippets,
      sshKeys
    };
  }

  async function saveBackupFile() {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dateStr = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0];
    return await save({ defaultPath: `backup_termina_${dateStr}.json` });
  }

  async function handleExportPlainConfig() {
    try {
      const path = await saveBackupFile();
      if (!path) return;

      const exportPayload = await buildExportPayload();
      await writeTextFile(path, JSON.stringify(exportPayload, null, 2));
      showToast(ui.exported);
    } catch (e: any) {
      showToast(`Backup export failed: ${String(e)}`, true);
    }
  }

  async function handleExportEncryptedConfig() {
    showDialog({
      type: "prompt",
      title: t("pwdSet", settings.lang),
      placeholder: t("password", settings.lang),
      confirmPlaceholder: settings.lang === "de" ? "Passwort erneut eingeben" : "Enter password again",
      isPassword: true,
      requireConfirm: true,
      validate: (pwd: string, confirmPwd: string) => {
        if (!pwd || !confirmPwd) return "";
        if (pwd !== confirmPwd) {
          return settings.lang === "de"
            ? "Die Passwörter stimmen nicht überein."
            : "Passwords do not match.";
        }
        return "";
      },
      onConfirm: async (pwd: string) => {
        try {
          const path = await saveBackupFile();
          if (!path) return;

          const exportPayload = await buildExportPayload();
          const encrypted = await encryptData(JSON.stringify(exportPayload, null, 2), pwd);
          await writeTextFile(path, encrypted);
          showToast(ui.exported);
        } catch (e: any) {
          showToast(`Backup export failed: ${String(e)}`, true);
        }
      }
    });
  }

  async function handleImportConfig() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: "JSON/Backup", extensions: ["json", "bak"] }] });

      if (!path) return;

      const applyImportedData = async (parsed: any) => {
        if (parsed.settings) {
          setSettings({ ...settings, ...parsed.settings });
        }

        if (Array.isArray(parsed.connections)) {
          for (const c of parsed.connections) {
            const { id, ...connData } = c;
            await invoke("save_connection", { connection: connData });
          }
        }

        if (Array.isArray(parsed.snippets)) {
          for (const s of parsed.snippets) {
            await invoke("add_snippet", {
              name: s.name,
              command: s.command
            });
          }
        }

        if (Array.isArray(parsed.sshKeys)) {
          for (const k of parsed.sshKeys) {
            if (k?.private_key_path) {
              await invoke("save_ssh_key", {
                name: k.name || "Imported",
                publicKey: k.public_key || "",
                privateKeyPath: k.private_key_path,
                keyType: k.key_type || "imported"
              });
            }
          }
        }

        showToast(ui.importedBackup);
        setTimeout(() => window.location.reload(), 1500);
      };

      const rawContent = await readTextFile(path as string);

      try {
        const parsed = JSON.parse(rawContent);
        await applyImportedData(parsed);
        return;
      } catch {
      }

      showDialog({
        type: "prompt",
        title: t("pwdPrompt", settings.lang),
        isPassword: true,
        onConfirm: async (pwd: string) => {
          if (!pwd) return;

          try {
            const decrypted = await decryptData(rawContent, pwd);
            const parsed = JSON.parse(decrypted);
            await applyImportedData(parsed);
          } catch {
            showToast(ui.wrongPassword, true);
          }
        }
      });
    } catch (e: any) {
      showToast(`Backup import failed: ${String(e)}`, true);
    }
  }


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
                      onClick={() =>
                        showDialog({
                          type: "prompt",
                          title: t("generateKey", lang),
                          placeholder: t("name", lang),
                          onConfirm: async (val: string) => {
                            if (!val?.trim()) return;
                            try {
                              await invoke("generate_ssh_key", { name: val.trim(), keyType: "ed25519" });
                              await loadKeys();
                              showToast(ui.generated);
                            } catch (e: any) {
                              showToast(`Key generation failed: ${String(e)}`, true);
                            }
                          }
                        })
                      }
                      style={primaryBtnStyle}
                    >
                      <Plus size={15} />
                      {t("generateKey", lang)}
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          const { open } = await import("@tauri-apps/plugin-dialog");
                          const picked = await open({
                            multiple: false,
                            directory: false,
                            filters: [{ name: "SSH Key", extensions: ["pem", "key", "pub", "id_rsa", "id_ed25519"] }]
                          });

                          const filePath = Array.isArray(picked) ? picked[0] : picked;
                          if (!filePath || typeof filePath !== "string") return;

                          const fileName = filePath.split("/").pop()?.trim() || ui.importedLabel;

                          await invoke("save_ssh_key", {
                            name: fileName,
                            publicKey: "",
                            privateKeyPath: filePath,
                            keyType: "imported"
                          });

                          await loadKeys();
                          showToast(ui.imported);
                        } catch (e: any) {
                          showToast(`Key import failed: ${String(e)}`, true);
                        }
                      }}
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
                              {k.type} • {k.fingerprint}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button
                              onClick={() => {
                                writeText(k.public_key);
                                showToast(t("copied", lang));
                              }}
                              style={actionBtnStyle}
                              title={t("copy", lang)}
                            >
                              <Copy size={14} />
                            </button>

                            <button
                              onClick={() =>
                                showDialog({
                                  type: "confirm",
                                  title: t("confirmDelete", lang),
                                  onConfirm: async () => {
                                    try {
                                      await invoke("delete_ssh_key", { id: k.id });
                                      await loadKeys();
                                      showToast(t("delete", lang));
                                    } catch (e: any) {
                                      showToast(`Key delete failed: ${String(e)}`, true);
                                    }
                                  }
                                })
                              }
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
                      onClick={handleExportPlainConfig}
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
                      onClick={handleExportEncryptedConfig}
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
                      onClick={handleImportConfig}
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
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 0.8fr",
                      gap: 14
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 15,
                        background: "var(--bg-app)",
                        padding: 15
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 11,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "var(--bg-sidebar)",
                            border: "1px solid var(--border-subtle)"
                          }}
                        >
                          <MonitorCog size={16} color="var(--accent)" />
                        </span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>{ui.projectTitle}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>{ui.versionLabel}</div>
                        </div>
                      </div>

                      <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.58 }}>
                        {ui.projectText}
                      </div>

                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          borderRadius: 13,
                          background: "var(--bg-sidebar)",
                          border: "1px solid var(--border-subtle)"
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>
                          {ui.versionLabel}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-main)" }}>{ui.versionValue}</div>
                      </div>
                    </div>

                    <div
                      style={{
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 15,
                        background: "var(--bg-app)",
                        padding: 15,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: 14
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 11,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "var(--bg-sidebar)",
                              border: "1px solid var(--border-subtle)"
                            }}
                          >
                            <Heart size={16} color="var(--accent)" />
                          </span>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>{ui.supportTitle}</div>
                        </div>

                        <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.55 }}>
                          {ui.supportText}
                        </div>

                        <div
                          style={{
                            marginTop: 12,
                            padding: 11,
                            borderRadius: 13,
                            background: "var(--bg-sidebar)",
                            border: "1px solid var(--border-subtle)",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            wordBreak: "break-all"
                          }}
                        >
                          https://ko-fi.com/ming83
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "row", gap: 9 }}>
                        <button
                          onClick={async () => {
                            const ok = await openExternalLink("https://ko-fi.com/ming83");
                            if (!ok) showToast("Could not open link", true);
                          }}
                          style={primaryBtnStyle}
                        >
                          <Heart size={15} />
                          {ui.openKofi}
                        </button>

                        <button
                          onClick={async () => {
                            const ok = await copyToClipboard("https://ko-fi.com/ming83");
                            if (ok) showToast(ui.copiedLink);
                            else showToast("Clipboard failed", true);
                          }}
                          style={actionBtnStyle}
                        >
                          <Copy size={15} />
                          {ui.copyLink}
                        </button>
                      </div>
                    </div>
                  </div>
                </SettingCard>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
