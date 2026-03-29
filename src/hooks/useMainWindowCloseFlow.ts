import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export type EditorWindowInfo = {
  label: string
  fileName: string
  remotePath: string
  dirty: boolean
}

type Args = {
  openTabs: any[]
  closeToTray: boolean
}

export function useMainWindowCloseFlow({ openTabs, closeToTray }: Args) {
  const [editorWindows, setEditorWindows] = useState<EditorWindowInfo[]>([])
  const [mainCloseDialogOpen, setMainCloseDialogOpen] = useState(false)
  const [mainCloseDialogBusy, setMainCloseDialogBusy] = useState(false)
  const [sessionCloseDialogOpen, setSessionCloseDialogOpen] = useState(false)

  const channelRef = useRef<BroadcastChannel | null>(null)
  const mainClosingRef = useRef(false)
  const mainWaitingForEditorsRef = useRef(false)
  const openTabsRef = useRef<any[]>(openTabs)
  const editorWindowsRef = useRef<EditorWindowInfo[]>([])
  const mainCloseDialogBusyRef = useRef(false)
  const closeToTrayRef = useRef(closeToTray)

  useEffect(() => {
    openTabsRef.current = openTabs
  }, [openTabs])

  useEffect(() => {
    editorWindowsRef.current = editorWindows
  }, [editorWindows])

  useEffect(() => {
    mainCloseDialogBusyRef.current = mainCloseDialogBusy
  }, [mainCloseDialogBusy])

  useEffect(() => {
    closeToTrayRef.current = closeToTray
  }, [closeToTray])

  const finalizeMainClose = useCallback(async () => {
    if (mainClosingRef.current) return
    mainClosingRef.current = true
    try {
      await invoke("save_window_state_all")
    } catch {}

    const win = getCurrentWindow()
    await win.close()
  }, [])

  const requestEditorClose = useCallback((force: boolean) => {
    const currentEditors = editorWindowsRef.current

    if (currentEditors.length === 0) {
      mainWaitingForEditorsRef.current = false
      void finalizeMainClose()
      return
    }

    mainWaitingForEditorsRef.current = true
    channelRef.current?.postMessage({
      type: "main-request-close-editors",
      force
    })
  }, [finalizeMainClose])

  const continueMainCloseFlow = useCallback(async () => {
    if (mainCloseDialogBusyRef.current) return

    const currentEditors = editorWindowsRef.current

    if (currentEditors.length === 0) {
      await finalizeMainClose()
      return
    }

    const dirty = currentEditors.filter((item) => item.dirty)

    if (dirty.length > 0) {
      mainWaitingForEditorsRef.current = false
      setMainCloseDialogOpen(true)
      return
    }

    requestEditorClose(false)
  }, [finalizeMainClose, requestEditorClose])

  useEffect(() => {
    const channel = new BroadcastChannel("termina-editor-sync")
    channelRef.current = channel

    channel.onmessage = (event) => {
      const msg = event.data || {}

      if (msg.type === "editor-state" && msg.label) {
        setEditorWindows((prev) => {
          const nextItem: EditorWindowInfo = {
            label: String(msg.label),
            fileName: String(msg.fileName || ""),
            remotePath: String(msg.remotePath || ""),
            dirty: Boolean(msg.dirty)
          }

          const filtered = prev.filter((item) => item.label !== nextItem.label)
          return [...filtered, nextItem]
        })
        return
      }

      if (msg.type === "editor-closed" && msg.label) {
        setEditorWindows((prev) => {
          const next = prev.filter((item) => item.label !== msg.label)

          if (mainWaitingForEditorsRef.current && next.length === 0) {
            mainWaitingForEditorsRef.current = false
            window.setTimeout(() => {
              void finalizeMainClose()
            }, 0)
          }

          return next
        })
      }
    }

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [finalizeMainClose])

  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined

    win.onCloseRequested(async (event) => {
      if (mainClosingRef.current) return

      event.preventDefault()

      if (mainCloseDialogBusyRef.current) return

      if (closeToTrayRef.current) {
        await win.hide()
        return
      }

      const currentTabs = openTabsRef.current

      if (currentTabs.length > 0) {
        setSessionCloseDialogOpen(true)
        return
      }

      await continueMainCloseFlow()
    }).then((fn) => {
      unlisten = fn
    }).catch(console.error)

    return () => {
      if (unlisten) unlisten()
    }
  }, [continueMainCloseFlow])

  useEffect(() => {
    let unlistenTrayQuit: (() => void) | undefined

    listen("tray-quit-requested", async () => {
      if (mainClosingRef.current) return
      if (mainCloseDialogBusyRef.current) return

      const currentTabs = openTabsRef.current

      if (currentTabs.length > 0) {
        setSessionCloseDialogOpen(true)
        return
      }

      await continueMainCloseFlow()
    }).then((fn) => {
      unlistenTrayQuit = fn
    }).catch(console.error)

    return () => {
      if (unlistenTrayQuit) unlistenTrayQuit()
    }
  }, [continueMainCloseFlow])

  const dirtyEditors = useMemo(
    () => editorWindows.filter((item) => item.dirty),
    [editorWindows]
  )

  const cancelSessionCloseDialog = useCallback(() => {
    setSessionCloseDialogOpen(false)
  }, [])

  const confirmSessionCloseDialog = useCallback(async () => {
    setSessionCloseDialogOpen(false)
    await continueMainCloseFlow()
  }, [continueMainCloseFlow])

  const cancelMainCloseDialog = useCallback(() => {
    mainWaitingForEditorsRef.current = false
    setMainCloseDialogBusy(false)
    setMainCloseDialogOpen(false)
  }, [])

  const confirmMainCloseDialog = useCallback(() => {
    setMainCloseDialogBusy(true)
    setMainCloseDialogOpen(false)
    requestEditorClose(true)
  }, [requestEditorClose])

  return {
    dirtyEditors,
    sessionCloseDialogOpen,
    mainCloseDialogOpen,
    mainCloseDialogBusy,
    cancelSessionCloseDialog,
    confirmSessionCloseDialog,
    cancelMainCloseDialog,
    confirmMainCloseDialog
  }
}
