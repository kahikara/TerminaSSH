import React, { useEffect, useMemo, useRef, useState } from "react"
import { FileText, Trash2, X } from "lucide-react"

function notesKey(server: any) {
  if (server?.isLocal || server?.id === "local" || server?.host === "localhost") {
    return "termina_notes:local"
  }

  const user = String(server?.username || "")
  const host = String(server?.host || "")
  const port = String(server?.port || 22)

  return `termina_notes:${user}@${host}:${port}`
}

const shellStyle: React.CSSProperties = {
  position: "absolute",
  top: 40,
  right: 0,
  bottom: 0,
  width: 352,
  display: "flex",
  flexDirection: "column",
  background: "color-mix(in srgb, var(--bg-sidebar) 88%, var(--bg-app))",
  borderLeft: "1px solid var(--border-subtle)",
  zIndex: 25,
  transition: "transform 220ms ease, opacity 220ms ease",
  overflow: "hidden",
  boxShadow: "-14px 0 34px rgba(0,0,0,0.18)"
}

export default function NotesPanel({
  server,
  lang = "de",
  visible,
  onClose,
  showDialog
}: any) {
  const storageKey = useMemo(() => notesKey(server), [server])
  const [text, setText] = useState("")
  const [status, setStatus] = useState<"idle" | "saved">("idle")
  const saveTimerRef = useRef<number | null>(null)

  const subtitle = server?.isLocal
    ? (lang === "de" ? "Notizen für die lokale Sitzung" : "Notes for the local session")
    : `${server?.username || ""}@${server?.host || ""}`

  useEffect(() => {
    if (!visible) return

    try {
      const saved = localStorage.getItem(storageKey) || ""
      setText(saved)
      setStatus("idle")
    } catch {
      setText("")
      setStatus("idle")
    }
  }, [visible, storageKey])

  useEffect(() => {
    if (!visible) return

    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, text)
        setStatus("saved")
      } catch {}
    }, 220)

    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [text, storageKey, visible])

  return (
    <div
      style={{
        ...shellStyle,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none"
      }}
    >
      <div className="ui-panel-header" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ minWidth: 0 }}>
          <div className="ui-title">{lang === "de" ? "Notizen" : "Notes"}</div>
          <div className="ui-subtitle" style={{ marginTop: 2 }}>
            {subtitle}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() =>
              showDialog?.({
                type: "confirm",
                tone: "danger",
                title: lang === "de" ? "Notizen löschen" : "Clear notes",
                description:
                  lang === "de"
                    ? "Der gespeicherte Inhalt für diesen Server wird entfernt."
                    : "This removes the saved note content for this server.",
                confirmLabel: lang === "de" ? "Löschen" : "Clear",
                cancelLabel: lang === "de" ? "Abbrechen" : "Cancel",
                onConfirm: () => {
                  try {
                    localStorage.removeItem(storageKey)
                  } catch {}
                  setText("")
                  setStatus("idle")
                }
              })
            }
            className="ui-icon-btn"
            title={lang === "de" ? "Leeren" : "Clear"}
          >
            <Trash2 size={15} />
          </button>

          <button onClick={onClose} className="ui-icon-btn" title={lang === "de" ? "Schließen" : "Close"}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div style={{ padding: 12, borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          className="ui-panel"
          style={{
            borderRadius: 14,
            padding: 10,
            boxShadow: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <FileText size={15} />
            <span className="ui-label" style={{ margin: 0 }}>
              {lang === "de" ? "Server Notizen" : "Server notes"}
            </span>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              whiteSpace: "nowrap"
            }}
          >
            {status === "saved"
              ? (lang === "de" ? "Automatisch gespeichert" : "Saved automatically")
              : (lang === "de" ? "Wird gespeichert..." : "Saving...")}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <textarea
          value={text}
          onChange={(e) => {
            setStatus("idle")
            setText(e.target.value)
          }}
          placeholder={
            lang === "de"
              ? "Hier kannst du hostbezogene Notizen speichern, etwa Pfade, Befehle, Hinweise oder kleine TODOs."
              : "Store host specific notes here, like paths, commands, reminders or small TODOs."
          }
          style={{
            width: "100%",
            height: "100%",
            resize: "none",
            borderRadius: 14,
            border: "1px solid var(--border-subtle)",
            background: "color-mix(in srgb, var(--bg-app) 78%, var(--bg-sidebar))",
            color: "var(--text-main)",
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.5,
            outline: "none",
            boxSizing: "border-box"
          }}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
