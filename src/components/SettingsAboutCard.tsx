import { Heart, MonitorCog, Copy, Coffee } from "lucide-react"

type Props = {
  ui: any
  showToast: (msg: string, isErr?: boolean) => void
  openExternalLink: (url: string) => Promise<boolean>
  copyToClipboard: (text: string) => Promise<boolean>
  primaryBtnStyle: React.CSSProperties
  actionBtnStyle: React.CSSProperties
}

export default function SettingsAboutCard({
  ui,
  showToast,
  openExternalLink,
  copyToClipboard,
  primaryBtnStyle,
  actionBtnStyle
}: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.05fr 0.95fr",
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

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
            gap: 9
          }}
        >
          <button
            onClick={async () => {
              const ok = await openExternalLink("https://ko-fi.com/ming83")
              if (!ok) showToast("Could not open link", true)
            }}
            style={{
              ...primaryBtnStyle,
              width: "100%",
              padding: "0 14px",
              whiteSpace: "nowrap"
            }}
          >
            <Coffee size={15} />
            {ui.openKofi}
          </button>

          <button
            onClick={async () => {
              const ok = await copyToClipboard("https://ko-fi.com/ming83")
              if (ok) showToast(ui.copiedLink)
              else showToast("Clipboard failed", true)
            }}
            style={{
              ...actionBtnStyle,
              width: "100%",
              whiteSpace: "nowrap"
            }}
          >
            <Copy size={15} />
            {ui.copyLink}
          </button>
        </div>
      </div>
    </div>
  )
}
