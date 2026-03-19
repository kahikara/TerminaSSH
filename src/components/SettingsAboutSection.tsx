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

export default function SettingsAboutSection({
  ui,
  showToast,
  openExternalLink,
  copyToClipboard,
  primaryBtnStyle,
  actionBtnStyle
}: Props) {
  return (
    <SettingCard title={ui.projectTitle} desc={ui.aboutDesc}>
      <SettingsAboutCard
        ui={ui}
        showToast={showToast}
        openExternalLink={openExternalLink}
        copyToClipboard={copyToClipboard}
        primaryBtnStyle={primaryBtnStyle}
        actionBtnStyle={actionBtnStyle}
      />
    </SettingCard>
  )
}
