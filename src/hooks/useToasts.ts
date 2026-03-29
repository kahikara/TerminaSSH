import { useCallback, useEffect, useRef, useState } from "react"
import type { ToastItem } from "../lib/types"

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timeoutIdsRef = useRef<number[]>([])
  const nextToastIdRef = useRef(1)

  useEffect(() => {
    return () => {
      for (const timeoutId of timeoutIdsRef.current) {
        clearTimeout(timeoutId)
      }
      timeoutIdsRef.current = []
    }
  }, [])

  const showToast = useCallback((msg: string, isErr = false) => {
    const trimmed = String(msg || "").trim()
    if (!trimmed) return

    const id = nextToastIdRef.current++

    setToasts((prev) => [...prev, { id, msg: trimmed, isErr }])

    const timeoutId = window.setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((value) => value !== timeoutId)
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4000)

    timeoutIdsRef.current.push(timeoutId)
  }, [])

  return { toasts, showToast }
}
