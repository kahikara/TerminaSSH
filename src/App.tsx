import { useState, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { GlobalDialogState } from './lib/types';
import type { AppTab, ConnectionDraft, ConnectionItem, DashboardTab, EditableConnection, PaneStatePayload, SidebarContextMenuState, TabContextMenuState } from './lib/appTypes';
import { useAppSettings } from './hooks/useAppSettings';
import { useStartupVaultGate } from './hooks/useStartupVaultGate';
import { useConnectionHelpers } from './hooks/useConnectionHelpers';
import { useVaultConnectionUnlock } from './hooks/useVaultConnectionUnlock';
import { useHostKeyTrust } from './hooks/useHostKeyTrust';
import { useConnectionCollections } from './hooks/useConnectionCollections';
import { useQuickConnectFlow } from './hooks/useQuickConnectFlow';
import { useTabDragFlow } from './hooks/useTabDragFlow';
import { useSidebarSearchFlow } from './hooks/useSidebarSearchFlow';
import { useLinuxWindowChrome } from './hooks/useLinuxWindowChrome';
import { useSidebarLayout } from './hooks/useSidebarLayout';
import { useSidebarConnectionActions } from './hooks/useSidebarConnectionActions';
import { useSplitTabState } from './hooks/useSplitTabState';
import { useTabContextActions } from './hooks/useTabContextActions';
import { useToasts } from './hooks/useToasts';
import SettingsModal from './components/SettingsModal';
import TerminalPane from './components/TerminalPane';
import SftpEditorWindow from "./components/SftpEditorWindow";
import ConnectionModal from './components/ConnectionModal';
import Dashboard from './components/Dashboard';
import GlobalDialog from './components/GlobalDialog';
import { useMainWindowCloseFlow } from './hooks/useMainWindowCloseFlow';
import SessionCloseDialog from './components/SessionCloseDialog';
import MainCloseDialog from './components/MainCloseDialog';
import ToastStack from './components/ToastStack';
import InputContextMenu from './components/InputContextMenu';
import StartupRecoveryResultDialog from './components/StartupRecoveryResultDialog';
import QuickConnectDialog from './components/QuickConnectDialog';
import TabContextMenu from './components/TabContextMenu';
import SidebarContextMenu from './components/SidebarContextMenu';
import LinuxTitlebar from './components/LinuxTitlebar';
import TabStrip from './components/TabStrip';
import SidebarShell from './components/SidebarShell';
import DraggedTabGhost from './components/DraggedTabGhost';
import SidebarConnectionsPanel from './components/SidebarConnectionsPanel';
import { runOpenTerminalFlow } from './lib/openTerminalCore';
import { useInputContextMenu } from './hooks/useInputContextMenu';
import { runOpenServerInSplitFlow } from './lib/openServerInSplitFlow';

const LOCAL_TERMINAL_CONNECTION: ConnectionItem = {
  id: 'local',
  isLocal: true,
  name: 'Local Terminal',
  username: 'local',
  host: '__local__'
}

const createTabId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const createClosedDialogState = (): GlobalDialogState => ({
  isOpen: false,
  type: 'alert',
  tone: undefined,
  title: '',
  description: '',
  placeholder: '',
  defaultValue: '',
  defaultConfirmValue: '',
  confirmPlaceholder: '',
  isPassword: false,
  requireConfirm: false,
  allowEmpty: false,
  checkboxLabel: '',
  checkboxDefaultChecked: false,
  confirmLabel: '',
  cancelLabel: '',
  secondaryLabel: '',
  tertiaryLabel: '',
  onConfirm: async () => {},
  onCancel: () => {},
  onSecondary: undefined,
  onTertiary: undefined,
  validate: undefined
})

const isDashboardTab = (value: AppTab): value is AppTab & DashboardTab => {
  return typeof value?.tabId === 'string' && typeof value?.name === 'string' && value.name.trim().length > 0
}

const isEditableConnection = (
  value: ConnectionItem | null | undefined
): value is EditableConnection => {
  return value?.id !== undefined && value?.id !== null && typeof value?.name === 'string' && value.name.trim().length > 0
}


export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.get("editor") === "sftp" || params.get("editor") === "local") {
    return <SftpEditorWindow />
  }

  const { settings, setSettings } = useAppSettings();
  
  const [openTabs, setOpenTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnModalOpen, setConnModalOpen] = useState(false);
  const [serverToEdit, setServerToEdit] = useState<ConnectionItem | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);

  const {
    dirtyEditors,
    sessionCloseDialogOpen,
    mainCloseDialogOpen,
    mainCloseDialogBusy,
    cancelSessionCloseDialog,
    confirmSessionCloseDialog,
    cancelMainCloseDialog,
    confirmMainCloseDialog
  } = useMainWindowCloseFlow({
    openTabs,
    closeToTray: Boolean(settings.closeToTray)
  })

  const { toasts, showToast } = useToasts();

  useEffect(() => {
    invoke("set_tray_visible", { visible: Boolean(settings.closeToTray) }).catch((e) => {
      showToast(
        settings.lang === 'de'
          ? `Tray konnte nicht aktualisiert werden: ${String(e)}`
          : `Could not update tray visibility: ${String(e)}`,
        true
      );
    });
  }, [settings.closeToTray, settings.lang, showToast]);

  const [dialog, setDialog] = useState<GlobalDialogState>(createClosedDialogState());
  const showDialog = useCallback((config: Partial<GlobalDialogState>) => {
    setDialog({
      ...createClosedDialogState(),
      ...config,
      isOpen: true
    })
  }, [])


  const { inputMenu, runInputMenuAction } = useInputContextMenu({
    lang: settings.lang,
    showToast
  });

  const {
    startupVaultGateState,
    startupRecoveryDialog,
    closeStartupRecoveryDialog,
    copyStartupRecoveryKey,
    downloadStartupRecoveryKey,
    markStartupVaultUnlocked
  } = useStartupVaultGate({
    lang: settings.lang,
    showDialog,
    showToast
  })

  const {
    isLocalConnection,
    getConnectionIdentity,
    needsSessionPasswordPrompt,
    applyPromptPasswordToServer
  } = useConnectionHelpers()

  const {
    ensureVaultUnlockedForConnection
  } = useVaultConnectionUnlock({
    lang: settings.lang,
    showDialog,
    showToast,
    markStartupVaultUnlocked,
    isLocalConnection
  })

  const {
    ensureHostKeyTrusted
  } = useHostKeyTrust({
    lang: settings.lang,
    showDialog,
    showToast,
    isLocalConnection
  })

  const {
    isQuickConnectOpen,
    quickConnectDraft,
    setQuickConnectDraft,
    openQuickConnect,
    closeQuickConnect,
    submitQuickConnect
  } = useQuickConnectFlow({
    openConnection: (server) => {
      void openTerminal(server)
    }
  })

  const {
    sidebarWidth,
    isSidebarCollapsed,
    toggleSidebarCollapse,
    startSidebarResize
  } = useSidebarLayout()

  const {
    showSidebarSearch,
    sidebarSearchQuery,
    setSidebarSearchQuery,
    sidebarSearchInputRef,
    toggleSidebarSearch
  } = useSidebarSearchFlow({
    isSidebarCollapsed
  })

  const {
    useCustomLinuxTitlebar,
    isWindowMaximized,
    startWindowDrag,
    toggleWindowMaximize,
    minimizeWindow,
    closeMainWindow
  } = useLinuxWindowChrome()

  const isMacPlatform = useMemo(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string }
    }

    const platform = String(nav.userAgentData?.platform || navigator.platform || '')
    const userAgent = String(navigator.userAgent || '')

    return /mac/i.test(platform) || /mac os/i.test(userAgent)
  }, [])


  const {
    loadServers,
    groups,
    collapsedConnections,
    sidebarVisibleGroups,
    sidebarVisibleRootServers,
    isSidebarSearching,
    effectiveFolderCollapsed,
    recentConnectionsForDashboard,
    isLocalActive,
    isServerActive
  } = useConnectionCollections({
    lang: settings.lang,
    customFolders: settings.customFolders || [],
    showToast,
    sidebarSearchQuery,
    showSidebarSearch,
    collapsedFolders,
    openTabs,
    activeTabId
  })

  const {
    tabDragId,
    tabDropId,
    tabPointerDragging,
    tabGhostPos,
    handleTabPointerStart,
    handleTabPointerEnter
  } = useTabDragFlow({
    onReorderTabs: (fromTabId, toTabId) => {
      setOpenTabs((prev) => {
        const fromIndex = prev.findIndex((tab) => tab.tabId === fromTabId)
        const toIndex = prev.findIndex((tab) => tab.tabId === toTabId)

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev

        const next = [...prev]
        const movedItems = next.splice(fromIndex, 1)
        const moved = movedItems[0]
        if (!moved) return prev
        next.splice(toIndex, 0, moved)
        return next
      })
    }
  })

  const draggedTabGhost = useMemo<AppTab | null>(
    () => openTabs.find((tab) => tab.tabId === tabDragId) || null,
    [openTabs, tabDragId]
  );

  const tabContextMenuTab = useMemo<AppTab | null>(
    () => tabContextMenu ? openTabs.find((tab) => tab.tabId === tabContextMenu.tabId) || null : null,
    [openTabs, tabContextMenu]
  );

  const dashboardActiveTabs = useMemo<DashboardTab[]>(
    () => openTabs.filter(isDashboardTab),
    [openTabs]
  );


  const openTerminal = async (
    server: ConnectionItem,
    options: { forceNewTab?: boolean; openInSplit?: boolean } = {}
  ) => {
    await runOpenTerminalFlow({
      lang: settings.lang,
      server,
      options,
      openTabs,
      isLocalConnection,
      ensureHostKeyTrusted,
      ensureVaultUnlockedForConnection,
      needsSessionPasswordPrompt,
      applyPromptPasswordToServer,
      showDialog,
      showToast,
      loadServers,
      setOpenTabs,
      setActiveTabId,
      createTabId,
      openServerInSplit
    })
  };

  const closeSidebarContextMenu = useCallback(() => {
    setSidebarContextMenu(null);
  }, []);

  const openSettingsModal = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  const closeSettingsModal = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

  const openNewConnectionModal = useCallback(() => {
    setServerToEdit(null)
    setConnectionDraft(null)
    setConnModalOpen(true)
  }, [])

  const openEditConnectionModal = useCallback((server: ConnectionItem) => {
    setConnectionDraft(null)
    setServerToEdit(server)
    setConnModalOpen(true)
  }, [])

  const openDuplicateConnectionModal = useCallback((draft: ConnectionDraft) => {
    setServerToEdit(null)
    setConnectionDraft(draft)
    setConnModalOpen(true)
  }, [])

  const closeConnectionModal = useCallback(() => {
    setConnModalOpen(false)
    setServerToEdit(null)
    setConnectionDraft(null)
  }, [])

  const {
    editSidebarServer,
    duplicateSidebarServer,
    deleteSidebarServer
  } = useSidebarConnectionActions({
    lang: settings.lang,
    closeSidebarContextMenu,
    showToast,
    showDialog,
    loadServers,
    openEditConnectionModal,
    openDuplicateConnectionModal
  })

  const closeTabContextMenu = useCallback(() => {
    setTabContextMenu(null);
  }, []);

  const openTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveTabId(tabId);
    setTabContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabId
    });
  }, []);

  const {
    buildSplitTabFromServers,
    updateTabFromPaneState
  } = useSplitTabState({
    createTabId,
    setOpenTabs
  })

  const openServerInSplit = async (server: ConnectionItem) => {
    await runOpenServerInSplitFlow({
      lang: settings.lang,
      server,
      activeTabId,
      openTabs,
      openTerminal: async (nextServer) => {
        await openTerminal(nextServer)
      },
      getConnectionIdentity,
      isLocalConnection,
      ensureHostKeyTrusted,
      ensureVaultUnlockedForConnection,
      needsSessionPasswordPrompt,
      applyPromptPasswordToServer,
      showDialog,
      showToast,
      loadServers,
      buildSplitTabFromServers,
      setOpenTabs,
      setActiveTabId
    })
  };

  const openSidebarContextMenu = useCallback((e: React.MouseEvent, server: ConnectionItem, isLocal = false) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarContextMenu({
      x: e.clientX,
      y: e.clientY,
      server,
      isLocal
    });
  }, []);

  const closeTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.tabId !== tabId);
      setActiveTabId(current => (
        current === tabId
          ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].tabId : null)
          : current
      ));
      return newTabs;
    });
  }, []);

  const {
    duplicateTabSession,
    openTabInSplit,
    removeSplitFromTab,
    closeTabFromContextMenu
  } = useTabContextActions({
    closeTabContextMenu,
    openTerminalNewTab: (server) => {
      void openTerminal(server, { forceNewTab: true })
    },
    buildSplitTabFromServers,
    updateOpenTabs: (updater) => {
      setOpenTabs(updater)
    },
    setActiveTabId,
    closeTab: (tabId) => {
      closeTab(tabId)
    }
  })

    

  return (
    <div
      className="flex h-screen w-full font-sans overflow-hidden relative bg-[var(--bg-app)]"
      style={{
        border: useCustomLinuxTitlebar
          ? '1px solid color-mix(in srgb, var(--border-subtle) 88%, rgba(255,255,255,0.08))'
          : undefined,
        boxShadow: useCustomLinuxTitlebar
          ? '0 0 0 1px color-mix(in srgb, var(--bg-app) 72%, transparent) inset'
          : undefined
      }}
    >
      {!useCustomLinuxTitlebar && isMacPlatform && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-[295] h-px"
          style={{
            background: 'color-mix(in srgb, var(--border-subtle) 88%, rgba(255,255,255,0.10))'
          }}
        />
      )}

      <GlobalDialog dialog={dialog} onClose={() => setDialog((prev) => ({ ...prev, isOpen: false }))} />

      {startupVaultGateState !== 'open' && (
        <div className="absolute inset-0 z-[290] bg-[color-mix(in_srgb,var(--bg-app)_96%,black)]" />
      )}

      {useCustomLinuxTitlebar && (
        <LinuxTitlebar
          lang={settings.lang}
          isWindowMaximized={isWindowMaximized}
          onStartDrag={startWindowDrag}
          onToggleMaximize={toggleWindowMaximize}
          onMinimize={minimizeWindow}
          onClose={closeMainWindow}
        />
      )}

      <SidebarShell
        isCollapsed={isSidebarCollapsed}
        width={sidebarWidth}
        useCustomLinuxTitlebar={useCustomLinuxTitlebar}
        lang={settings.lang}
        onOpenSettings={openSettingsModal}
        onToggleCollapse={toggleSidebarCollapse}
        onStartResize={startSidebarResize}
      >
        <SidebarConnectionsPanel
          isSidebarCollapsed={isSidebarCollapsed}
          lang={settings.lang}
          showSidebarSearch={showSidebarSearch}
          sidebarSearchQuery={sidebarSearchQuery}
          sidebarSearchInputRef={sidebarSearchInputRef}
          collapsedConnections={collapsedConnections}
          sidebarVisibleRootServers={sidebarVisibleRootServers}
          sidebarVisibleGroups={sidebarVisibleGroups}
          isSidebarSearching={isSidebarSearching}
          groups={groups}
          effectiveFolderCollapsed={effectiveFolderCollapsed}
          isLocalActive={isLocalActive}
          isServerActive={isServerActive}
          onToggleSearch={toggleSidebarSearch}
          onSidebarSearchChange={setSidebarSearchQuery}
          onClearSidebarSearch={() => setSidebarSearchQuery("")}
          onOpenLocalTerminalNewTab={() => {
            void openTerminal(LOCAL_TERMINAL_CONNECTION, { forceNewTab: true })
          }}
          onOpenNewConnection={openNewConnectionModal}
          onOpenQuickConnect={openQuickConnect}
          onGoHome={() => setActiveTabId(null)}
          onOpenConnection={(server, options) => {
            void openTerminal(server, options)
          }}
          onOpenSidebarContextMenu={openSidebarContextMenu}
          onOpenConnectionSettings={openEditConnectionModal}
          onToggleFolder={(group) => {
            setCollapsedFolders((prev) => ({
              ...prev,
              [group]: !Boolean(prev[group])
            }))
          }}
          onRemoveEmptyFolder={(group) => {
            setSettings((prev) => ({
              ...prev,
              customFolders: prev.customFolders.filter((f) => f !== group)
            }))
          }}
          localTerminalConnection={LOCAL_TERMINAL_CONNECTION}
        />
      </SidebarShell>

      <div
        style={{ paddingTop: useCustomLinuxTitlebar ? 30 : 0 }}
        className="flex-1 flex flex-col h-full relative z-10 min-w-0"
      >
        <TabStrip
          isVisible={Boolean(activeTabId)}
          openTabs={openTabs}
          activeTabId={activeTabId}
          tabDragId={tabDragId}
          tabDropId={tabDropId}
          tabPointerDragging={tabPointerDragging}
          onTabPointerStart={handleTabPointerStart}
          onTabPointerEnter={handleTabPointerEnter}
          onActivateTab={setActiveTabId}
          onOpenTabContextMenu={openTabContextMenu}
          onCloseTab={closeTab}
        />

        <div className="flex-1 relative min-w-0 min-h-0 bg-[var(--bg-app)] overflow-hidden">
           <div className={`absolute inset-0 ${!activeTabId ? 'block' : 'hidden'}`}>
              <Dashboard
                lang={settings.lang}
                settings={settings}
                openTerminal={openTerminal}
                activeTabs={dashboardActiveTabs}
                recentConns={recentConnectionsForDashboard}
                activateTab={(tabId: string) => setActiveTabId(tabId)}
              />
           </div>
           {openTabs.map(tab => (
              <div key={tab.tabId} className={`absolute inset-0 ${activeTabId === tab.tabId ? 'block' : 'hidden'}`}>
                 <TerminalPane
                   server={tab}
                   sessionId={tab.sessionId}
                   settings={settings}
                   showToast={showToast}
                   onCloseTab={() => closeTab(tab.tabId)}
                   onPaneStateChange={(payload: PaneStatePayload) => updateTabFromPaneState(tab.tabId, payload)}
                   isActive={activeTabId === tab.tabId}
                   showDialog={showDialog}
                 />
              </div>
           ))}
        </div>
      </div>
      <QuickConnectDialog
        isOpen={isQuickConnectOpen}
        lang={settings.lang}
        draft={quickConnectDraft}
        setDraft={setQuickConnectDraft}
        onClose={closeQuickConnect}
        onSubmit={submitQuickConnect}
      />

      <SidebarContextMenu
        isOpen={Boolean(sidebarContextMenu)}
        x={sidebarContextMenu?.x ?? 0}
        y={sidebarContextMenu?.y ?? 0}
        isLocal={Boolean(sidebarContextMenu?.isLocal)}
        lang={settings.lang}
        onClose={closeSidebarContextMenu}
        onOpen={() => {
          if (!sidebarContextMenu) return
          closeSidebarContextMenu()
          void openTerminal(sidebarContextMenu.server)
        }}
        onOpenInNewTab={() => {
          if (!sidebarContextMenu) return
          closeSidebarContextMenu()
          void openTerminal(sidebarContextMenu.server, { forceNewTab: true })
        }}
        onOpenInSplit={() => {
          if (!sidebarContextMenu) return
          closeSidebarContextMenu()
          void openTerminal(sidebarContextMenu.server, { openInSplit: true })
        }}
        onEdit={() => {
          if (!sidebarContextMenu) return
          editSidebarServer(sidebarContextMenu.server)
        }}
        onDuplicate={() => {
          if (!sidebarContextMenu) return
          duplicateSidebarServer(sidebarContextMenu.server)
        }}
        onDelete={() => {
          if (!sidebarContextMenu) return
          deleteSidebarServer(sidebarContextMenu.server)
        }}
      />

      <TabContextMenu
        isOpen={Boolean(tabContextMenu && tabContextMenuTab)}
        x={tabContextMenu?.x ?? 0}
        y={tabContextMenu?.y ?? 0}
        splitMode={Boolean(tabContextMenuTab?.splitMode)}
        lang={settings.lang}
        onClose={closeTabContextMenu}
        onDuplicateSession={() => {
          if (!tabContextMenuTab) return
          duplicateTabSession(tabContextMenuTab)
        }}
        onOpenInSplit={() => {
          if (!tabContextMenuTab) return
          openTabInSplit(tabContextMenuTab)
        }}
        onDuplicateLeftSession={() => {
          if (!tabContextMenuTab) return
          duplicateTabSession(tabContextMenuTab, 0)
        }}
        onDuplicateRightSession={() => {
          if (!tabContextMenuTab) return
          duplicateTabSession(tabContextMenuTab, 1)
        }}
        onRemoveSplit={() => {
          if (!tabContextMenuTab) return
          removeSplitFromTab(tabContextMenuTab)
        }}
        onCloseTab={() => {
          if (!tabContextMenuTab) return
          closeTabFromContextMenu(tabContextMenuTab)
        }}
      />

      <ConnectionModal
        isOpen={isConnModalOpen}
        onClose={closeConnectionModal}
        serverToEdit={isEditableConnection(serverToEdit) ? serverToEdit : null}
        initialConnection={connectionDraft}
        onSuccess={loadServers}
        showToast={showToast}
        showDialog={showDialog}
        globalDialogOpen={dialog.isOpen}
        lang={settings.lang}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={closeSettingsModal}
        settings={settings}
        setSettings={setSettings}
        showToast={showToast}
        showDialog={showDialog}
        globalDialogOpen={dialog.isOpen}
      />

      <SessionCloseDialog
        isOpen={sessionCloseDialogOpen}
        openTabs={openTabs}
        lang={settings.lang}
        onCancel={cancelSessionCloseDialog}
        onConfirm={confirmSessionCloseDialog}
      />

      <MainCloseDialog
        isOpen={mainCloseDialogOpen}
        busy={mainCloseDialogBusy}
        dirtyEditors={dirtyEditors}
        lang={settings.lang}
        onCancel={cancelMainCloseDialog}
        onConfirm={confirmMainCloseDialog}
      />

      <DraggedTabGhost
        isVisible={Boolean(tabPointerDragging && draggedTabGhost && tabGhostPos)}
        x={tabGhostPos?.x ?? 0}
        y={tabGhostPos?.y ?? 0}
        name={draggedTabGhost?.name || ''}
      />
      <StartupRecoveryResultDialog
        isOpen={startupRecoveryDialog.isOpen}
        lang={settings.lang}
        recoveryKey={startupRecoveryDialog.key}
        onCopy={copyStartupRecoveryKey}
        onDownload={downloadStartupRecoveryKey}
        onClose={closeStartupRecoveryDialog}
      />

      <InputContextMenu
        inputMenu={inputMenu}
        lang={settings.lang}
        onAction={runInputMenuAction}
      />

      <ToastStack toasts={toasts} />
    </div>
  );
}
