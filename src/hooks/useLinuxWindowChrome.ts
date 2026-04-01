import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type LinuxWindowModeInfo = {
  wayland_undecorated?: boolean
}

type AppMetaInfo = {
  app_version?: string
}

export function useLinuxWindowChrome() {
  const [useCustomLinuxTitlebar, setUseCustomLinuxTitlebar] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  const startWindowDrag = useCallback(() => {
    void invoke('window_start_dragging').catch(() => {})
  }, [])

  const toggleWindowMaximize = useCallback(() => {
    void invoke('window_toggle_maximize')
      .then((value) => setIsWindowMaximized(Boolean(value)))
      .catch(() => {})
  }, [])

  const minimizeWindow = useCallback(() => {
    void invoke('window_minimize').catch(() => {})
  }, [])

  const closeMainWindow = useCallback(() => {
    void invoke('window_close_main').catch(() => {})
  }, [])

  useEffect(() => {
    invoke('get_linux_window_mode')
      .then((info) => {
        const mode = (info || {}) as LinuxWindowModeInfo
        const useCustomChrome = Boolean(mode.wayland_undecorated) && !(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        setUseCustomLinuxTitlebar(useCustomChrome)
      })
      .catch(() => {
        setUseCustomLinuxTitlebar(false)
      })

    invoke('get_app_meta')
      .then((info) => {
        const meta = (info || {}) as AppMetaInfo
        setAppVersion(String(meta.app_version || ''))
      })
      .catch(() => {
        setAppVersion('')
      })
  }, [])

  useEffect(() => {
    if (!useCustomLinuxTitlebar) return

    let mounted = true
    let timer: number | undefined

    const syncIfMounted = async () => {
      try {
        const value = await invoke('window_is_maximized') as boolean
        if (mounted) setIsWindowMaximized(Boolean(value))
      } catch {}
    }

    const restartTimer = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }

      if (document.visibilityState === 'visible') {
        timer = window.setInterval(() => {
          void syncIfMounted()
        }, 2000)
      }
    }

    const handleWindowStateHint = () => {
      void syncIfMounted()
    }

    const handleVisibilityChange = () => {
      restartTimer()
      if (document.visibilityState === 'visible') {
        void syncIfMounted()
      }
    }

    void syncIfMounted()
    restartTimer()

    window.addEventListener('resize', handleWindowStateHint)
    window.addEventListener('focus', handleWindowStateHint)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      window.removeEventListener('resize', handleWindowStateHint)
      window.removeEventListener('focus', handleWindowStateHint)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [useCustomLinuxTitlebar])

  return {
    useCustomLinuxTitlebar,
    isWindowMaximized,
    appVersion,
    startWindowDrag,
    toggleWindowMaximize,
    minimizeWindow,
    closeMainWindow
  }
}
