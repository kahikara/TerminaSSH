import type { MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'

type TabItem = {
  tabId: string
  name?: string
}

type TabStripProps = {
  isVisible: boolean
  openTabs: TabItem[]
  activeTabId: string | null
  tabDragId: string | null
  tabDropId: string | null
  tabPointerDragging: boolean
  onTabPointerStart: (e: ReactMouseEvent<HTMLDivElement>, tabId: string) => void
  onTabPointerEnter: (tabId: string) => void
  onActivateTab: (tabId: string) => void
  onOpenTabContextMenu: (e: ReactMouseEvent, tabId: string) => void
  onCloseTab: (tabId: string, e?: ReactMouseEvent) => void
}

export default function TabStrip({
  isVisible,
  openTabs,
  activeTabId,
  tabDragId,
  tabDropId,
  tabPointerDragging,
  onTabPointerStart,
  onTabPointerEnter,
  onActivateTab,
  onOpenTabContextMenu,
  onCloseTab
}: TabStripProps) {
  if (!isVisible) return null

  return (
    <div className="h-10 flex bg-[color-mix(in_srgb,var(--bg-sidebar)_96%,var(--bg-app))] border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
      <div className="flex overflow-x-auto h-full scrollbar-hide w-full items-end pt-1 px-2 gap-1.5">
        {openTabs.map((tab) => {
          const dragIndex = tabDragId ? openTabs.findIndex((t) => t.tabId === tabDragId) : -1
          const dropIndex = tabDropId ? openTabs.findIndex((t) => t.tabId === tabDropId) : -1
          const isDragged = tabDragId === tab.tabId && tabPointerDragging
          const isDropTarget = tabDropId === tab.tabId && tabDragId !== tab.tabId && tabPointerDragging
          const dropOnLeft = isDropTarget && dragIndex > dropIndex
          const dropOnRight = isDropTarget && dragIndex < dropIndex

          return (
            <div
              key={tab.tabId}
              onMouseDown={(e) => onTabPointerStart(e, tab.tabId)}
              onMouseEnter={() => onTabPointerEnter(tab.tabId)}
              onClick={() => onActivateTab(tab.tabId)}
              onContextMenu={(e) => onOpenTabContextMenu(e, tab.tabId)}
              className={`relative flex items-center justify-between gap-2 px-3.5 cursor-pointer text-[13px] transition-all min-w-[136px] max-w-[196px] h-[32px] rounded-t-xl border border-b-0 ${
                activeTabId === tab.tabId
                  ? 'bg-[var(--bg-app)] text-[var(--text-main)] border-[var(--border-subtle)] border-t-[color-mix(in_srgb,var(--accent)_72%,white)] border-t-2 z-10 shadow-sm'
                  : 'bg-[color-mix(in_srgb,var(--bg-sidebar)_96%,var(--bg-app))] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] border-transparent'
              } ${
                tabPointerDragging && !isDragged ? 'opacity-85' : ''
              } ${
                isDragged ? 'opacity-60 -translate-y-1 scale-[0.985] shadow-none' : ''
              } ${
                isDropTarget ? 'ring-1 ring-[color-mix(in_srgb,var(--accent)_44%,transparent)]' : ''
              }`}
            >
              {dropOnLeft && (
                <span className="absolute left-[-2px] top-1 bottom-1 w-[3px] rounded-full bg-[var(--accent)] pointer-events-none" />
              )}
              {dropOnRight && (
                <span className="absolute right-[-2px] top-1 bottom-1 w-[3px] rounded-full bg-[var(--accent)] pointer-events-none" />
              )}

              <span className="truncate flex-1 min-w-0">{tab.name}</span>
              <button
                data-no-tab-drag="true"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => onCloseTab(tab.tabId, e)}
                className="p-1 rounded-full hover:bg-[var(--danger)] hover:text-white text-[var(--text-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-app)]"
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
