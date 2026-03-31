import { useCallback, useEffect, useState } from 'react'
import type { ConnectionItem, QuickConnectDraft } from '../lib/appTypes'

type UseQuickConnectFlowArgs = {
  openConnection: (server: ConnectionItem) => void
}

const EMPTY_DRAFT: QuickConnectDraft = {
  user: '',
  host: '',
  port: '22'
}

export function useQuickConnectFlow({
  openConnection
}: UseQuickConnectFlowArgs) {
  const [isQuickConnectOpen, setQuickConnectOpen] = useState(false)
  const [quickConnectDraft, setQuickConnectDraft] = useState<QuickConnectDraft>(EMPTY_DRAFT)

  const closeQuickConnect = useCallback(() => {
    setQuickConnectOpen(false)
    setQuickConnectDraft(EMPTY_DRAFT)
  }, [])

  const openQuickConnect = useCallback(() => {
    setQuickConnectOpen(true)
  }, [])

  const submitQuickConnect = useCallback((e?: React.FormEvent) => {
    e?.preventDefault()

    const host = quickConnectDraft.host.trim()
    const username = quickConnectDraft.user.trim()
    const parsedPort = parseInt(quickConnectDraft.port.trim() || '22', 10)
    const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 22

    if (!host) return

    closeQuickConnect()
    openConnection({
      isQuickConnect: true,
      quickConnectNeedsPassword: true,
      name: host,
      username,
      host,
      port
    })
  }, [closeQuickConnect, openConnection, quickConnectDraft.host, quickConnectDraft.port, quickConnectDraft.user])

  useEffect(() => {
    if (!isQuickConnectOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeQuickConnect()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [closeQuickConnect, isQuickConnectOpen])

  return {
    isQuickConnectOpen,
    quickConnectDraft,
    setQuickConnectDraft,
    openQuickConnect,
    closeQuickConnect,
    submitQuickConnect
  }
}
