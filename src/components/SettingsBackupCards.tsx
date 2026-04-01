import { useState } from "react"
import { Save, Download as DownloadIcon, Database } from "lucide-react"

type Props = {
  lang: string
  cardStyle: React.CSSProperties
  onExportPlain: () => void | Promise<void>
  onExportEncrypted: () => void | Promise<void>
  onImport: () => void | Promise<void>
  importLabel: string
}

export default function SettingsBackupCards({
  lang,
  cardStyle,
  onExportPlain,
  onExportEncrypted,
  onImport,
  importLabel
}: Props) {
  const [busy, setBusy] = useState(false)

  async function runAction(action: () => void | Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await Promise.resolve(action())
    } finally {
      setBusy(false)
    }
  }

  const buttonStyle: React.CSSProperties = {
    ...cardStyle,
    background: "var(--bg-app)",
    cursor: busy ? "not-allowed" : "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 140,
    opacity: busy ? 0.6 : 1
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12
      }}
    >
      <button
        onClick={() => { void runAction(onExportPlain) }}
        disabled={busy}
        style={buttonStyle}
      >
        <Save size={26} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>
          {lang === "de" ? "JSON Backup ohne Passwort" : "JSON backup without password"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
          {lang === "de"
            ? "Speichert das Backup als lesbare JSON Datei ohne Passwortschutz."
            : "Saves the backup as a readable JSON file without password protection."}
        </div>
      </button>

      <button
        onClick={() => { void runAction(onExportEncrypted) }}
        disabled={busy}
        style={buttonStyle}
      >
        <Database size={26} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>
          {lang === "de" ? "Verschlüsseltes Backup mit Passwort" : "Encrypted backup with password"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
          {lang === "de"
            ? "Schützt das Backup mit AES 256 und Passwort."
            : "Protects the backup with AES 256 and a password."}
        </div>
      </button>

      <button
        onClick={() => { void runAction(onImport) }}
        disabled={busy}
        style={buttonStyle}
      >
        <DownloadIcon size={26} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-main)" }}>
          {importLabel}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
          {lang === "de"
            ? "Importiert JSON Backups ohne Passwort oder verschlüsselte Backups mit Passwort."
            : "Imports JSON backups without password or encrypted backups with password."}
        </div>
      </button>
    </div>
  )
}
