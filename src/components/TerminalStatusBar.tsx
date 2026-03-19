import { Cable, Cpu, MemoryStick } from "lucide-react"

type StatusBarItem = {
  kind: "load" | "ram"
  value: string
}

type Props = {
  showStatusBarSession: boolean
  showStatusBarTunnel: boolean
  activeTunnelLabel: string
  sessionDuration: string
  statusBarRightItems: StatusBarItem[]
}

export default function TerminalStatusBar({
  showStatusBarSession,
  showStatusBarTunnel,
  activeTunnelLabel,
  sessionDuration,
  statusBarRightItems
}: Props) {
  return (
    <div
      style={{
        minHeight: 28,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderTop: "1px solid color-mix(in srgb, var(--border-subtle, rgba(255,255,255,0.08)) 72%, transparent)",
        background: "color-mix(in srgb, var(--bg-sidebar) 94%, var(--bg-app))",
        fontSize: 11,
        color: "var(--text-muted, #94a3b8)"
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {showStatusBarSession && <span>{sessionDuration}</span>}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {showStatusBarTunnel && activeTunnelLabel ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            <Cable size={12} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activeTunnelLabel}</span>
          </span>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 14,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {statusBarRightItems.map((item) => (
          <span
            key={`${item.kind}:${item.value}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {item.kind === "load" ? <Cpu size={12} /> : <MemoryStick size={12} />}
            <span>{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
