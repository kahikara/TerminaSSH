import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, Home, Settings } from 'lucide-react'
import { t } from '../lib/i18n'

type SidebarShellProps = {
  isCollapsed: boolean
  width: number
  useCustomLinuxTitlebar: boolean
  lang: string
  onGoHome: () => void
  onOpenSettings: () => void
  onToggleCollapse: () => void
  onStartResize: () => void
  children: ReactNode
}

export default function SidebarShell({
  isCollapsed,
  width,
  useCustomLinuxTitlebar,
  lang,
  onGoHome,
  onOpenSettings,
  onToggleCollapse,
  onStartResize,
  children
}: SidebarShellProps) {
  return (
    <div
      style={{
        width: isCollapsed ? 76 : width,
        paddingTop: useCustomLinuxTitlebar ? 30 : 0
      }}
      className="bg-[color-mix(in_srgb,var(--bg-sidebar)_94%,var(--bg-app))] flex flex-col flex-shrink-0 h-full relative z-20 shadow-xl"
    >
      <div className="flex-1 overflow-y-auto pt-3 pb-1.5 px-3 flex flex-col gap-3 min-h-0">
        {children}
      </div>

      <div className="px-3 pt-2 pb-2 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
        <div className={`flex ${isCollapsed ? 'flex-col items-center gap-1.5' : 'items-center justify-center gap-1.5'}`}>
          <button
            onClick={onGoHome}
            className="ui-icon-btn shrink-0"
            title={t('home', lang)}
          >
            <Home size={18} />
          </button>

          <button
            onClick={onOpenSettings}
            className="ui-icon-btn shrink-0"
            title={t('settings', lang)}
          >
            <Settings size={18} />
          </button>

          <button
            onClick={onToggleCollapse}
            className="ui-icon-btn shrink-0"
            title={isCollapsed ? t('sidebarExpand', lang) : t('sidebarCollapse', lang)}
          >
            {isCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10"
          onMouseDown={onStartResize}
        />
      )}
      <div className="absolute top-0 right-0 w-[1px] h-full bg-[var(--border-subtle)] pointer-events-none" />
    </div>
  )
}
