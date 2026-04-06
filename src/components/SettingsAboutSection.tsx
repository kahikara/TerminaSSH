import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SettingCard } from "./SettingsUi"
import SettingsAboutCard from "./SettingsAboutCard"

type Props = {
  ui: any
  showToast: any
  openExternalLink: any
  copyToClipboard: any
  primaryBtnStyle: React.CSSProperties
  actionBtnStyle: React.CSSProperties
}

type AppMetaInfo = {
  app_version?: string
}

export default function SettingsAboutSection({
  ui,
  showToast,
  openExternalLink,
  copyToClipboard,
  primaryBtnStyle,
  actionBtnStyle
}: Props) {
  const [appVersion, setAppVersion] = useState("")

  useEffect(() => {
    let mounted = true

    const loadAppMeta = async () => {
      try {
        const meta = await invoke("get_app_meta") as AppMetaInfo
        if (mounted) {
          setAppVersion(String(meta?.app_version || ""))
        }
      } catch {
      }
    }

    void loadAppMeta()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <SettingCard title={ui.projectTitle} desc={ui.aboutDesc}>
      <SettingsAboutCard
        ui={ui}
        appVersion={appVersion}
        showToast={showToast}
        openExternalLink={openExternalLink}
        copyToClipboard={copyToClipboard}
        primaryBtnStyle={primaryBtnStyle}
        actionBtnStyle={actionBtnStyle}
      />
    </SettingCard>
  )
}
