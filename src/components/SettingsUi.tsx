import type { ReactNode } from "react"

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--bg-sidebar) 82%, var(--bg-app))",
  borderRadius: 14,
  padding: 14
}

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 0",
  borderTop: "1px solid color-mix(in srgb, var(--border-subtle) 65%, transparent)"
}

export function SettingCard({
  title,
  children
}: {
  title: string
  desc?: string
  children: ReactNode
}) {
  const hasTitle = title.trim().length > 0

  return (
    <div style={cardStyle}>
      {hasTitle ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 700, color: "var(--text-main)" }}>{title}</div>
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function FieldRow({
  label,
  children,
  first = false
}: {
  label: string
  desc?: string
  children: ReactNode
  first?: boolean
}) {
  return (
    <div style={{ ...fieldRowStyle, borderTop: first ? "none" : fieldRowStyle.borderTop }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, lineHeight: 1.25, fontWeight: 600, color: "var(--text-main)" }}>{label}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (next: boolean) => void
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
  )
}
