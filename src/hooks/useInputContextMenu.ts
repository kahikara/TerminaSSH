import { useEffect, useState } from "react"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"

export type InputContextMenuState = {
  open: boolean
  x: number
  y: number
  target: HTMLInputElement | HTMLTextAreaElement | null
}

type UseInputContextMenuArgs = {
  lang: string
  showToast?: (msg: string, isErr?: boolean) => void
}

const emptyState: InputContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  target: null
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false

  const blocked = new Set([
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "file",
    "color",
    "range",
    "date",
    "datetime-local",
    "month",
    "time",
    "week",
    "hidden",
    "image"
  ])

  return !blocked.has(el.type)
}

function replaceInputSelection(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const nextValue = el.value.slice(0, start) + text + el.value.slice(end)

  el.value = nextValue
  const nextPos = start + text.length
  el.setSelectionRange(nextPos, nextPos)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

export function useInputContextMenu({ lang, showToast }: UseInputContextMenuArgs) {
  const [inputMenu, setInputMenu] = useState<InputContextMenuState>(emptyState)

  const closeInputMenu = () => {
    setInputMenu(emptyState)
  }

  const runInputMenuAction = async (action: "copy" | "paste" | "cut" | "selectAll") => {
    const el = inputMenu.target
    if (!el) return

    try {
      el.focus()

      if (action === "selectAll") {
        el.select()
        closeInputMenu()
        return
      }

      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const selectedText = el.value.slice(start, end)
      const canEdit = !el.readOnly && !el.disabled

      if (action === "copy") {
        if (!selectedText) {
          closeInputMenu()
          return
        }
        await writeText(selectedText)
        closeInputMenu()
        return
      }

      if (action === "cut") {
        if (!selectedText || !canEdit) {
          closeInputMenu()
          return
        }
        await writeText(selectedText)
        replaceInputSelection(el, "")
        closeInputMenu()
        return
      }

      if (action === "paste") {
        if (!canEdit) {
          closeInputMenu()
          return
        }
        const text = await readText()
        if (!text) {
          closeInputMenu()
          return
        }
        replaceInputSelection(el, text)
        closeInputMenu()
        return
      }
    } catch (e: any) {
      showToast?.(
        lang === "de"
          ? `Kontextmenü Aktion fehlgeschlagen: ${String(e)}`
          : `Context menu action failed: ${String(e)}`,
        true
      )
      closeInputMenu()
    }
  }

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return

      const target = e.target as Element | null
      const field = target?.closest("input, textarea") ?? null

      if (isTextField(field)) {
        e.preventDefault()
        e.stopPropagation()

        field.focus()

        const menuWidth = 176
        const menuHeight = 172
        const nextX = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
        const nextY = Math.min(e.clientY, window.innerHeight - menuHeight - 8)

        setInputMenu({
          open: true,
          x: Math.max(8, nextX),
          y: Math.max(8, nextY),
          target: field
        })
        return
      }

      e.preventDefault()
      closeInputMenu()
    }

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-input-context-menu="true"]')) return
      closeInputMenu()
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInputMenu()
    }

    const handleWindowChange = () => closeInputMenu()

    window.addEventListener("contextmenu", handleContextMenu)
    window.addEventListener("mousedown", handlePointerDown)
    window.addEventListener("keydown", handleEscape)
    window.addEventListener("resize", handleWindowChange)
    window.addEventListener("scroll", handleWindowChange, true)

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu)
      window.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("keydown", handleEscape)
      window.removeEventListener("resize", handleWindowChange)
      window.removeEventListener("scroll", handleWindowChange, true)
    }
  }, [lang, inputMenu.target])

  return {
    inputMenu,
    runInputMenuAction,
    closeInputMenu
  }
}
