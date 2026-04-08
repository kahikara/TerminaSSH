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
    gap: 8,
    minHeight: 96,
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
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-main)", textAlign: "center" }}>
          {lang === "de" ? "JSON Backup" : "JSON backup"}
        </div>
      </button>

      <button
        onClick={() => { void runAction(onExportEncrypted) }}
        disabled={busy}
        style={buttonStyle}
      >
        <Database size={26} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-main)", textAlign: "center" }}>
          {lang === "de" ? "Geschütztes Backup" : "Encrypted backup"}
        </div>
      </button>

      <button
        onClick={() => { void runAction(onImport) }}
        disabled={busy}
        style={buttonStyle}
      >
        <DownloadIcon size={26} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-main)", textAlign: "center" }}>
          {importLabel}
        </div>
      </button>
    </div>
  )
}
