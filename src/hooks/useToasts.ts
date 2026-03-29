import { useCallback, useState } from "react"
import type { ToastItem } from "../lib/types"

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((msg: string, isErr = false) => {
    const trimmed = String(msg || "").trim()
    if (!trimmed) return

    const id = Date.now() + Math.floor(Math.random() * 1000)

    setToasts((prev) => [...prev, { id, msg: trimmed, isErr }])

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4000)
  }, [])

  return { toasts, showToast }
}
