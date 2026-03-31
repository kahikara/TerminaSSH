import { useCallback, useEffect, useRef, useState } from 'react'

export function useSidebarLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  const isDragging = useRef(false)
  const expandedSidebarWidthRef = useRef(260)

  useEffect(() => {
    if (!isSidebarCollapsed) {
      expandedSidebarWidthRef.current = sidebarWidth
    }
  }, [sidebarWidth, isSidebarCollapsed])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return
    setSidebarWidth(Math.min(Math.max(e.clientX, 200), 600))
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    document.body.style.cursor = 'default'
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const toggleSidebarCollapse = useCallback(() => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false)
      setSidebarWidth(expandedSidebarWidthRef.current || 260)
      return
    }

    expandedSidebarWidthRef.current = sidebarWidth
    setIsSidebarCollapsed(true)
  }, [isSidebarCollapsed, sidebarWidth])

  const startSidebarResize = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
  }, [])

  return {
    sidebarWidth,
    isSidebarCollapsed,
    toggleSidebarCollapse,
    startSidebarResize
  }
}
