import type { CSSProperties } from "react"
import { X } from "lucide-react"

type Props = {
  title: string
  subtitle: string
  onClose: () => void
  closeLabel: string
  iconButton: CSSProperties
}

export default function SettingsModalHeader({
  title,
  subtitle,
  onClose,
  closeLabel,
  iconButton
}: Props) {
  return (
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
        <div style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 700, color: "var(--text-main)" }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {subtitle}
        </div>
      </div>

      <button onClick={onClose} style={iconButton} title={closeLabel}>
        <X size={18} />
      </button>
    </div>
  )
}
