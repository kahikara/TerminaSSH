import { useEffect, useState } from "react"
import type { AppSettings } from "../lib/types"

const SETTINGS_STORAGE_KEY = "termina_settings"

const defaultSettings: AppSettings = {
  lang: "en",
  theme: "catppuccin",
  fontSize: 14,
  cursorStyle: "bar",
  cursorBlink: true,
  scrollback: 10000,
  sftpHidden: false,
  sftpSort: "folders",
  showSplit: true,
  showSftp: true,
  showTunnels: true,
  showSnippets: true,
  showSearch: true,
  showNotes: true,
  showDashboardQuickConnect: true,
  showDashboardWorkflow: true,
  showDashboardActiveSessions: true,
  showDashboardRecentConnections: true,
  showStatusBar: true,
  showStatusBarSession: true,
  showStatusBarTunnel: true,
  showStatusBarLoad: true,
  showStatusBarRam: true,
  closeToTray: false,
  customFolders: []
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizeSettings(parsed: any): AppSettings {
  let normalizedSort = parsed?.sftpSort
  if (normalizedSort === "az") normalizedSort = "name"
  if (normalizedSort === "za") normalizedSort = "name"
  if (!["folders", "name", "size", "type"].includes(normalizedSort)) normalizedSort = "folders"

  const normalizedTheme = ["catppuccin", "nord", "pitch-black", "light"].includes(parsed?.theme)
    ? parsed.theme
    : defaultSettings.theme

  const normalizedLang = ["en", "de"].includes(parsed?.lang)
    ? parsed.lang
    : defaultSettings.lang

  const normalizedCursorStyle = ["block", "bar", "underline"].includes(parsed?.cursorStyle)
    ? parsed.cursorStyle
    : defaultSettings.cursorStyle

  return {
    ...defaultSettings,
    ...parsed,
    lang: normalizedLang,
    theme: normalizedTheme,
    fontSize: clampNumber(parsed?.fontSize, 8, 48, defaultSettings.fontSize),
    cursorStyle: normalizedCursorStyle,
    cursorBlink: parsed?.cursorBlink !== false,
    scrollback: clampNumber(parsed?.scrollback, 100, 200000, defaultSettings.scrollback),
    sftpSort: normalizedSort,
    showSplit: parsed?.showSplit !== false,
    showSftp: parsed?.showSftp !== false,
    showTunnels: parsed?.showTunnels !== false,
    showSnippets: parsed?.showSnippets !== false,
    showSearch: parsed?.showSearch !== false,
    showNotes: parsed?.showNotes !== false,
    showDashboardQuickConnect: parsed?.showDashboardQuickConnect !== false,
    showDashboardWorkflow: parsed?.showDashboardWorkflow !== false,
    showDashboardActiveSessions: parsed?.showDashboardActiveSessions !== false,
    showDashboardRecentConnections: parsed?.showDashboardRecentConnections !== false,
    showStatusBar: parsed?.showStatusBar !== false,
    showStatusBarSession: parsed?.showStatusBarSession !== false,
    showStatusBarTunnel: parsed?.showStatusBarTunnel !== false,
    showStatusBarLoad: parsed?.showStatusBarLoad !== false,
    showStatusBarRam: parsed?.showStatusBarRam !== false,
    closeToTray: parsed?.closeToTray === true,
    customFolders: Array.isArray(parsed?.customFolders) ? parsed.customFolders : []
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (!saved) return defaultSettings
      return normalizeSettings(JSON.parse(saved))
    } catch {
      return defaultSettings
    }
  })

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    document.documentElement.setAttribute("data-theme", settings.theme)
  }, [settings])

  return { settings, setSettings }
}
