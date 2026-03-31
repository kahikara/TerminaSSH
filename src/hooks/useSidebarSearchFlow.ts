import { useCallback, useEffect, useRef, useState } from 'react'

type UseSidebarSearchFlowArgs = {
  isSidebarCollapsed: boolean
}

export function useSidebarSearchFlow({
  isSidebarCollapsed
}: UseSidebarSearchFlowArgs) {
  const [showSidebarSearch, setShowSidebarSearch] = useState(false)
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('')
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null)
  const sidebarSearchFocusTimerRef = useRef<number | null>(null)

  const closeSidebarSearch = useCallback(() => {
    if (sidebarSearchFocusTimerRef.current !== null) {
      clearTimeout(sidebarSearchFocusTimerRef.current)
      sidebarSearchFocusTimerRef.current = null
    }

    setShowSidebarSearch(false)
    setSidebarSearchQuery('')
  }, [])

  const toggleSidebarSearch = useCallback(() => {
    if (showSidebarSearch) {
      closeSidebarSearch()
      return
    }

    if (sidebarSearchFocusTimerRef.current !== null) {
      clearTimeout(sidebarSearchFocusTimerRef.current)
      sidebarSearchFocusTimerRef.current = null
    }

    setShowSidebarSearch(true)
    sidebarSearchFocusTimerRef.current = window.setTimeout(() => {
      sidebarSearchInputRef.current?.focus()
      sidebarSearchInputRef.current?.select()
      sidebarSearchFocusTimerRef.current = null
    }, 0)
  }, [closeSidebarSearch, showSidebarSearch])

  useEffect(() => {
    return () => {
      if (sidebarSearchFocusTimerRef.current !== null) {
        clearTimeout(sidebarSearchFocusTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!showSidebarSearch) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeSidebarSearch()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [closeSidebarSearch, showSidebarSearch])

  useEffect(() => {
    if (!isSidebarCollapsed) return
    if (!showSidebarSearch && !sidebarSearchQuery) return

    setShowSidebarSearch(false)
    setSidebarSearchQuery('')
  }, [isSidebarCollapsed, showSidebarSearch, sidebarSearchQuery])

  return {
    showSidebarSearch,
    sidebarSearchQuery,
    setSidebarSearchQuery,
    sidebarSearchInputRef,
    closeSidebarSearch,
    toggleSidebarSearch
  }
}
