import type { CSSProperties } from "react"
import type { SettingsNavItem, } from "./settingsNav"
import type { SettingsSectionId } from "../lib/types"

type Props = {
  navItems: SettingsNavItem[]
  activeTab: SettingsSectionId
  setActiveTab: (tab: SettingsSectionId) => void
  navButtonBase: CSSProperties
}

export default function SettingsSidebar({
  navItems,
  activeTab,
  setActiveTab,
  navButtonBase
}: Props) {
  return (
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
        const Icon = item.icon
        const active = activeTab === item.id

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
        )
      })}
    </div>
  )
}
