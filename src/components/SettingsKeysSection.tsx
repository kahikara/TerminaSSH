import { Plus, Upload, Trash2, Copy } from "lucide-react"
import { t } from "../lib/i18n"
import type { StoredSshKey } from "../lib/types"
import { SettingCard } from "./SettingsUi"

type Props = {
  lang: string
  ui: any
  keys: StoredSshKey[]
  loadKeys: () => Promise<void>
  showDialog: any
  showToast: any
  primaryBtnStyle: React.CSSProperties
  actionBtnStyle: React.CSSProperties
  promptGenerateSshKey: any
  importExistingSshKey: any
  copySshPublicKey: any
  confirmDeleteSshKey: any
}

export default function SettingsKeysSection({
  lang,
  ui,
  keys,
  loadKeys,
  showDialog,
  showToast,
  primaryBtnStyle,
  actionBtnStyle,
  promptGenerateSshKey,
  importExistingSshKey,
  copySshPublicKey,
  confirmDeleteSshKey
}: Props) {
  return (
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10
          }}
        >
          {keys.map((k) => (
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
                gap: 14,
                minWidth: 0
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text-main)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {k.name}
                </div>
                <div
                  title={`${k.key_type} • ${k.fingerprint}`}
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                    fontFamily: "JetBrains Mono, monospace",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {k.key_type} • {k.fingerprint}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => void copySshPublicKey({ publicKey: k.public_key, lang, showToast })}
                  style={{
                    ...actionBtnStyle,
                    opacity: k.public_key ? 1 : 0.5,
                    cursor: k.public_key ? "pointer" : "not-allowed"
                  }}
                  title={k.public_key ? t("copy", lang) : (lang === "de" ? "Kein öffentlicher Schlüssel verfügbar" : "No public key available")}
                  disabled={!k.public_key}
                >
                  <Copy size={14} />
                </button>

                <button
                  onClick={() => confirmDeleteSshKey({ id: k.id, name: k.name, lang, showDialog, showToast, loadKeys })}
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
  )
}
