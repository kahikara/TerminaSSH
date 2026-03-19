import { Save, Download as DownloadIcon, Database } from "lucide-react"

type Props = {
  lang: string
  cardStyle: React.CSSProperties
  onExportPlain: () => void
  onExportEncrypted: () => void
  onImport: () => void
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
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12
      }}
    >
      <button
        onClick={onExportPlain}
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
        onClick={onExportEncrypted}
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
        onClick={onImport}
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
          {importLabel}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, textAlign: "center" }}>
          {lang === "de"
            ? "Importiert normale JSON Backups oder verschlüsselte Backups."
            : "Imports plain JSON backups or encrypted backups."}
        </div>
      </button>
    </div>
  )
}
