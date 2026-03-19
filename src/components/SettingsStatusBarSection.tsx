import { SettingCard, FieldRow, Toggle } from "./SettingsUi"

type Props = {
  ui: any
  settings: any
  setSettings: (next: any) => void
}

export default function SettingsStatusBarSection({
  ui,
  settings,
  setSettings
}: Props) {
  return (
    <SettingCard title={ui.statusBar} desc={ui.statusBarDesc}>
      <FieldRow label={ui.showStatusBarLabel} desc={ui.showStatusBarLabelDesc} first>
        <Toggle
          checked={settings.showStatusBar !== false}
          onChange={(next) => setSettings({ ...settings, showStatusBar: next })}
        />
      </FieldRow>

      <FieldRow label={ui.showStatusBarSessionLabel} desc={ui.showStatusBarSessionLabelDesc}>
        <Toggle
          checked={settings.showStatusBarSession !== false}
          onChange={(next) => setSettings({ ...settings, showStatusBarSession: next })}
        />
      </FieldRow>

      <FieldRow label={ui.showStatusBarTunnelLabel} desc={ui.showStatusBarTunnelLabelDesc}>
        <Toggle
          checked={settings.showStatusBarTunnel !== false}
          onChange={(next) => setSettings({ ...settings, showStatusBarTunnel: next })}
        />
      </FieldRow>

      <FieldRow label={ui.showStatusBarLoadLabel} desc={ui.showStatusBarLoadLabelDesc}>
        <Toggle
          checked={settings.showStatusBarLoad !== false}
          onChange={(next) => setSettings({ ...settings, showStatusBarLoad: next })}
        />
      </FieldRow>

      <FieldRow label={ui.showStatusBarRamLabel} desc={ui.showStatusBarRamLabelDesc}>
        <Toggle
          checked={settings.showStatusBarRam !== false}
          onChange={(next) => setSettings({ ...settings, showStatusBarRam: next })}
        />
      </FieldRow>
    </SettingCard>
  )
}
