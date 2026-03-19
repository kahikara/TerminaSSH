import {
  Terminal as TermIcon,
  Folder,
  Key,
  Database,
  Info,
  Globe,
  MonitorCog
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { t } from "../lib/i18n"
import type { SettingsSectionId } from "../lib/types"

export type SettingsNavItem = {
  id: SettingsSectionId
  icon: LucideIcon
  label: string
}

export function getSettingsNavItems(lang: string, ui: any): SettingsNavItem[] {
  return [
    { id: "general", icon: Globe, label: ui.general },
    { id: "statusbar", icon: MonitorCog, label: ui.statusBar },
    { id: "terminal", icon: TermIcon, label: t("terminal", lang) },
    { id: "sftp", icon: Folder, label: t("sftp", lang) },
    { id: "keys", icon: Key, label: t("keyManager", lang) },
    { id: "backup", icon: Database, label: t("backup", lang) },
    { id: "about", icon: Info, label: ui.about }
  ]
}
