import { useCallback, useEffect, useRef, useState } from 'react'

type PointerPos = {
  x: number
  y: number
}

type UseTabDragFlowArgs = {
  onReorderTabs: (fromTabId: string, toTabId: string) => void
}

export function useTabDragFlow({
  onReorderTabs
}: UseTabDragFlowArgs) {
  const [tabDragId, setTabDragId] = useState<string | null>(null)
  const [tabDropId, setTabDropId] = useState<string | null>(null)
  const [tabPointerDragging, setTabPointerDragging] = useState(false)
  const [tabGhostPos, setTabGhostPos] = useState<PointerPos | null>(null)

  const tabDragStartXRef = useRef<number | null>(null)

  const clearTabPointerState = useCallback(() => {
    setTabDragId(null)
    setTabDropId(null)
    setTabPointerDragging(false)
    setTabGhostPos(null)
    tabDragStartXRef.current = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  const handleTabPointerStart = useCallback((e: React.MouseEvent<HTMLDivElement>, tabId: string) => {
    if (e.button !== 0) return

    const target = e.target as HTMLElement | null
    if (target?.closest('[data-no-tab-drag="true"]')) return

    setTabDragId(tabId)
    setTabDropId(tabId)
    setTabPointerDragging(false)
    setTabGhostPos({ x: e.clientX, y: e.clientY })
    tabDragStartXRef.current = e.clientX
    document.body.style.userSelect = 'none'
  }, [])

  const handleTabPointerEnter = useCallback((tabId: string) => {
    if (!tabDragId) return
    if (!tabPointerDragging) return
    if (tabId === tabDragId) return
    setTabDropId(tabId)
  }, [tabDragId, tabPointerDragging])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!tabDragId) return
      if (tabDragStartXRef.current == null) return

      if (!tabPointerDragging) {
        if (Math.abs(e.clientX - tabDragStartXRef.current) < 5) return
        setTabPointerDragging(true)
        document.body.style.cursor = 'grabbing'
      }

      setTabGhostPos({ x: e.clientX, y: e.clientY })
    }

    const onUp = () => {
      if (!tabDragId) return

      if (tabPointerDragging && tabDropId && tabDropId !== tabDragId) {
        onReorderTabs(tabDragId, tabDropId)
      }

      clearTabPointerState()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [clearTabPointerState, onReorderTabs, tabDragId, tabDropId, tabPointerDragging])

  useEffect(() => {
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  return {
    tabDragId,
    tabDropId,
    tabPointerDragging,
    tabGhostPos,
    handleTabPointerStart,
    handleTabPointerEnter
  }
}
