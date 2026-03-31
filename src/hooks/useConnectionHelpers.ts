import { useCallback } from 'react'
import type { ConnectionItem } from '../lib/appTypes'

export function useConnectionHelpers() {
  const isLocalConnection = useCallback((server: ConnectionItem | null | undefined) => {
    return (
      !!server?.isLocal ||
      server?.type === 'local' ||
      server?.kind === 'local' ||
      server?.id === 'local' ||
      server?.name === 'Local Terminal' ||
      server?.host === '__local__' ||
      server?.host === 'local'
    )
  }, [])

  const getConnectionIdentity = useCallback((server: ConnectionItem | null | undefined) => {
    if (isLocalConnection(server)) return '__local__'
    if (server?.id != null) return `id:${String(server.id)}`
    return [
      String(server?.username || '').trim(),
      String(server?.host || '').trim(),
      String(server?.port || 22)
    ].join('@')
  }, [isLocalConnection])

  const needsSessionPasswordPrompt = useCallback((server: ConnectionItem) => {
    if (isLocalConnection(server)) return false
    if (server?.isQuickConnect) return !!server?.quickConnectNeedsPassword

    return server?.has_password === false && !server?.private_key
  }, [isLocalConnection])

  const applyPromptPasswordToServer = useCallback((server: ConnectionItem, pwd: string): ConnectionItem => {
    if (server?.isQuickConnect) {
      return {
        ...server,
        password: pwd,
        quickConnectNeedsPassword: false
      }
    }

    return {
      ...server,
      sessionPassword: pwd
    }
  }, [])

  return {
    isLocalConnection,
    getConnectionIdentity,
    needsSessionPasswordPrompt,
    applyPromptPasswordToServer
  }
}
