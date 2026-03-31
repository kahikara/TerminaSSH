import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { GlobalDialogState } from './lib/types';
import { useAppSettings } from './hooks/useAppSettings';
import { useStartupVaultGate } from './hooks/useStartupVaultGate';
import { useConnectionHelpers } from './hooks/useConnectionHelpers';
import { useVaultConnectionUnlock } from './hooks/useVaultConnectionUnlock';
import { useHostKeyTrust } from './hooks/useHostKeyTrust';
import { useConnectionCollections } from './hooks/useConnectionCollections';
import { useQuickConnectFlow } from './hooks/useQuickConnectFlow';
import { useTabDragFlow } from './hooks/useTabDragFlow';
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
import { useInputContextMenu } from './hooks/useInputContextMenu';
import { destroyTerminal } from './lib/terminalSession';

type LinuxWindowModeInfo = {
  wayland_undecorated?: boolean
}

type AppMetaInfo = {
  app_version?: string
}

type ConnectionItem = {
  id?: number | string
  name?: string
  host?: string
  port?: number
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  group_name?: string
  has_password?: boolean
  sessionPassword?: string | null
  isLocal?: boolean
  isQuickConnect?: boolean
  quickConnectNeedsPassword?: boolean
  splitMode?: boolean
  paneServers?: ConnectionItem[]
  paneSessionIds?: string[]
  focusedPaneIndex?: number
  type?: string
  kind?: string
  [key: string]: unknown
}

type AppTab = ConnectionItem & {
  tabId: string
  sessionId: string
}

type ConnectionDraft = {
  name?: string
  host?: string
  port?: number | string
  username?: string
  password?: string
  private_key?: string
  passphrase?: string
  group_name?: string
}

type SidebarContextMenuState = {
  x: number
  y: number
  server: ConnectionItem
  isLocal: boolean
}

type TabContextMenuState = {
  x: number
  y: number
  tabId: string
}

type DashboardConnection = {
  id?: string | number
  name: string
  host?: string
  port?: number
  username?: string
  isLocal?: boolean
  isQuickConnect?: boolean
  quickConnectNeedsPassword?: boolean
}

type DashboardTab = DashboardConnection & {
  tabId: string
}

type EditableConnection = {
  id: number | string
  name: string
  host?: string
  port?: number
  username?: string
  private_key?: string
  group_name?: string
}

type PaneStatePayload = {
  paneServers: ConnectionItem[]
  paneSessionIds: string[]
  focusedPaneId?: string | null
}

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

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { settings, setSettings } = useAppSettings();
  
  useEffect(() => {
    if (!isSidebarCollapsed) {
      expandedSidebarWidthRef.current = sidebarWidth;
    }
  }, [sidebarWidth, isSidebarCollapsed]);

  const [openTabs, setOpenTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnModalOpen, setConnModalOpen] = useState(false);
  const [serverToEdit, setServerToEdit] = useState<ConnectionItem | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [useCustomLinuxTitlebar, setUseCustomLinuxTitlebar] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible');

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
  const showDialog = (config: Partial<GlobalDialogState>) => setDialog({
    ...createClosedDialogState(),
    ...config,
    isOpen: true
  });

  const isDragging = useRef(false);
  const expandedSidebarWidthRef = useRef(260);
  const settingsRef = useRef(settings);
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarSearchFocusTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const syncVisibility = () => {
      setDocumentVisible(document.visibilityState === 'visible');
    };

    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('focus', syncVisibility);

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('focus', syncVisibility);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sidebarSearchFocusTimerRef.current !== null) {
        clearTimeout(sidebarSearchFocusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    invoke('get_linux_window_mode')
      .then((info) => {
        const mode = (info || {}) as LinuxWindowModeInfo
        setUseCustomLinuxTitlebar(Boolean(mode.wayland_undecorated))
      })
      .catch(() => {
        setUseCustomLinuxTitlebar(false)
      })

    invoke('get_app_meta')
      .then((info) => {
        const meta = (info || {}) as AppMetaInfo
        setAppVersion(String(meta.app_version || ""))
      })
      .catch(() => {
        setAppVersion("")
      })
  }, [])

  useEffect(() => {
    if (!useCustomLinuxTitlebar) return

    let mounted = true
    let timer: number | undefined

    const syncMaximized = async () => {
      try {
        const value = await invoke('window_is_maximized') as boolean
        if (mounted) setIsWindowMaximized(Boolean(value))
      } catch {}
    }

    const handleWindowStateHint = () => {
      void syncMaximized()
    }

    void syncMaximized()
    window.addEventListener('resize', handleWindowStateHint)
    window.addEventListener('focus', handleWindowStateHint)

    if (documentVisible) {
      timer = window.setInterval(() => {
        void syncMaximized()
      }, 2000)
    }

    return () => {
      mounted = false
      window.removeEventListener('resize', handleWindowStateHint)
      window.removeEventListener('focus', handleWindowStateHint)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [useCustomLinuxTitlebar, documentVisible])

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


  const handleMouseMove = (e: MouseEvent) => { if (isDragging.current) setSidebarWidth(Math.min(Math.max(e.clientX, 200), 600)); };
  const handleMouseUp = () => { isDragging.current = false; document.body.style.cursor = 'default'; };
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setSidebarWidth(expandedSidebarWidthRef.current || 260);
      return;
    }

    expandedSidebarWidthRef.current = sidebarWidth;
    setIsSidebarCollapsed(true);
  }, [isSidebarCollapsed, sidebarWidth]);

  const closeSidebarSearch = useCallback(() => {
    if (sidebarSearchFocusTimerRef.current !== null) {
      clearTimeout(sidebarSearchFocusTimerRef.current);
      sidebarSearchFocusTimerRef.current = null;
    }

    setShowSidebarSearch(false);
    setSidebarSearchQuery("");
  }, []);

  const toggleSidebarSearch = useCallback(() => {
    if (showSidebarSearch) {
      closeSidebarSearch();
      return;
    }

    if (sidebarSearchFocusTimerRef.current !== null) {
      clearTimeout(sidebarSearchFocusTimerRef.current);
      sidebarSearchFocusTimerRef.current = null;
    }

    setShowSidebarSearch(true);
    sidebarSearchFocusTimerRef.current = window.setTimeout(() => {
      sidebarSearchInputRef.current?.focus();
      sidebarSearchInputRef.current?.select();
      sidebarSearchFocusTimerRef.current = null;
    }, 0);
  }, [showSidebarSearch, closeSidebarSearch]);

  useEffect(() => {
    if (!showSidebarSearch) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeSidebarSearch();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showSidebarSearch, closeSidebarSearch]);

  useEffect(() => {
    if (!isSidebarCollapsed) return;
    if (!showSidebarSearch && !sidebarSearchQuery) return;
    setShowSidebarSearch(false);
    setSidebarSearchQuery("");
  }, [isSidebarCollapsed]);

  const openTerminal = async (
    server: ConnectionItem,
    options: { forceNewTab?: boolean; openInSplit?: boolean } = {}
  ) => {
    const findExistingTabId = (): string | null => {
      if (options.forceNewTab) return null;
      if (server?.isQuickConnect) return null;

      if (isLocalConnection(server)) {
        const existingLocal = openTabs.find((tab) => tab?.isLocal);
        return existingLocal?.tabId || null;
      }

      if (server?.id != null) {
        const existingServer = openTabs.find((tab) => String(tab?.id) === String(server.id));
        return existingServer?.tabId || null;
      }

      return null;
    };

    if (options.openInSplit) {
      await openServerInSplit(server);
      return;
    }

    const existingTabId = findExistingTabId();
    if (existingTabId) {
      setActiveTabId(existingTabId);
      return;
    }

    if (!(await ensureHostKeyTrusted(server))) {
      return;
    }

    if (!(await ensureVaultUnlockedForConnection(server))) {
      return;
    }

    if (needsSessionPasswordPrompt(server)) {
      showDialog({
        type: "prompt",
        title:
          settings.lang === "de"
            ? `Passwort für ${server?.name || server?.host || "SSH Verbindung"}`
            : `Password for ${server?.name || server?.host || "SSH connection"}`,
        placeholder: settings.lang === "de" ? "SSH Passwort eingeben" : "Enter SSH password",
        isPassword: true,
        checkboxLabel: settings.lang === "de" ? "Passwort speichern" : "Save password",
        onConfirm: async (pwd: string, meta?: { checked?: boolean }) => {
          if (!pwd) return;

          if (meta?.checked && server?.id != null) {
            try {
              await invoke("set_connection_password", {
                id: server.id,
                password: pwd
              });
              await loadServers();
              showToast(settings.lang === "de" ? "Passwort gespeichert" : "Password saved");
            } catch (e) {
              showToast(
                settings.lang === "de"
                  ? `Passwort konnte nicht gespeichert werden: ${String(e)}`
                  : `Could not save password: ${String(e)}`,
                true
              );
            }
          }

          const tabId = createTabId();
          const resolvedServer = applyPromptPasswordToServer(server, pwd);
          const newTab: AppTab = {
            ...resolvedServer,
            tabId,
            sessionId: tabId
          };
          setOpenTabs(prev => [...prev, newTab]);
          setActiveTabId(tabId);
        }
      });
      return;
    }

    const tabId = createTabId();
    const newTab: AppTab = { ...server, tabId, sessionId: tabId };
    setOpenTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  const closeSidebarContextMenu = useCallback(() => {
    setSidebarContextMenu(null);
  }, []);

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

  const buildSplitTabFromServers = (
    leftServer: ConnectionItem,
    rightServer: ConnectionItem,
    existingTabId?: string,
    existingPaneSessionIds?: string[],
    forceNewRightSession = false
  ): AppTab => {
    const tabId = existingTabId || createTabId();
    const leftSessionId =
      existingPaneSessionIds?.[0] && String(existingPaneSessionIds[0]).trim().length > 0
        ? String(existingPaneSessionIds[0])
        : tabId;
    const rightSessionId =
      !forceNewRightSession && existingPaneSessionIds?.[1] && String(existingPaneSessionIds[1]).trim().length > 0
        ? String(existingPaneSessionIds[1])
        : `${tabId}__pane_1_${Date.now().toString(36)}`;

    return {
      ...leftServer,
      tabId,
      sessionId: leftSessionId,
      splitMode: true,
      paneServers: [leftServer, rightServer],
      paneSessionIds: [leftSessionId, rightSessionId],
      focusedPaneIndex: 1,
      name: `${leftServer?.name || leftServer?.host || "Left"} | ${rightServer?.name || rightServer?.host || "Right"}`
    };
  };

  const openServerInSplit = async (server: ConnectionItem) => {
    if (!activeTabId) {
      await openTerminal(server);
      return;
    }

    const currentTab = openTabs.find((tab) => tab.tabId === activeTabId);
    if (!currentTab) {
      await openTerminal(server);
      return;
    }

    const currentPaneServers = currentTab.splitMode
      ? (currentTab.paneServers || []).filter(Boolean)
      : [currentTab];
    const currentPaneIdentities = new Set(currentPaneServers.map((item) => getConnectionIdentity(item)));
    const targetIdentity = getConnectionIdentity(server);

    if (
      currentTab.splitMode &&
      currentPaneServers.length >= 2 &&
      (currentPaneIdentities.size >= 2 || currentPaneIdentities.has(targetIdentity))
    ) {
      showToast(
        settings.lang === 'de'
          ? 'Ein Split Tab kann nur zwei verschiedene Verbindungen enthalten'
          : 'A split tab can only contain two different connections',
        true
      );
      return;
    }

    if (!isLocalConnection(server)) {
      if (!(await ensureHostKeyTrusted(server))) {
        return;
      }
    }

    if (!(await ensureVaultUnlockedForConnection(server))) {
      return;
    }

    if (needsSessionPasswordPrompt(server)) {
      showDialog({
        type: "prompt",
        title:
          settings.lang === "de"
            ? `Passwort für ${server?.name || server?.host || "SSH Verbindung"}`
            : `Password for ${server?.name || server?.host || "SSH connection"}`,
        placeholder: settings.lang === "de" ? "SSH Passwort eingeben" : "Enter SSH password",
        isPassword: true,
        checkboxLabel: settings.lang === "de" ? "Passwort speichern" : "Save password",
        onConfirm: async (pwd: string, meta?: { checked?: boolean }) => {
          if (!pwd) return;

          if (meta?.checked && server?.id != null) {
            try {
              await invoke("set_connection_password", {
                id: server.id,
                password: pwd
              });
              await loadServers();
              showToast(settings.lang === "de" ? "Passwort gespeichert" : "Password saved");
            } catch (e) {
              showToast(
                settings.lang === "de"
                  ? `Passwort konnte nicht gespeichert werden: ${String(e)}`
                  : `Could not save password: ${String(e)}`,
                true
              );
            }
          }

          const rightServer = applyPromptPasswordToServer(server, pwd);

          setOpenTabs(prev => {
            const next = [...prev];
            const idx = next.findIndex((tab) => tab.tabId === activeTabId);
            if (idx === -1) return prev;

            const baseTab = next[idx];
            const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab;
            const currentRightServer = baseTab?.splitMode ? baseTab.paneServers?.[1] || null : null;
            const existingPaneSessionIds = baseTab?.splitMode
              ? (baseTab.paneSessionIds || [])
              : [baseTab.sessionId];
            const reuseRightSession =
              Boolean(baseTab?.splitMode) &&
              currentRightServer != null &&
              getConnectionIdentity(currentRightServer) === targetIdentity;

            if (!reuseRightSession && existingPaneSessionIds[1]) {
              destroyTerminal(String(existingPaneSessionIds[1]));
            }

            next[idx] = buildSplitTabFromServers(
              leftServer,
              rightServer,
              activeTabId,
              existingPaneSessionIds,
              !reuseRightSession
            );
            return next;
          });

          setActiveTabId(activeTabId);
        }
      });
      return;
    }

    setOpenTabs(prev => {
      const next = [...prev];
      const idx = next.findIndex((tab) => tab.tabId === activeTabId);
      if (idx === -1) return prev;

      const baseTab = next[idx];
      const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab;
      const currentRightServer = baseTab?.splitMode ? baseTab.paneServers?.[1] || null : null;
      const existingPaneSessionIds = baseTab?.splitMode
        ? (baseTab.paneSessionIds || [])
        : [baseTab.sessionId];
      const reuseRightSession =
        Boolean(baseTab?.splitMode) &&
        currentRightServer != null &&
        getConnectionIdentity(currentRightServer) === targetIdentity;

      if (!reuseRightSession && existingPaneSessionIds[1]) {
        destroyTerminal(String(existingPaneSessionIds[1]));
      }

      next[idx] = buildSplitTabFromServers(
        leftServer,
        server,
        activeTabId,
        existingPaneSessionIds,
        !reuseRightSession
      );
      return next;
    });

    setActiveTabId(activeTabId);
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

  const editSidebarServer = useCallback((server: ConnectionItem) => {
    closeSidebarContextMenu();
    setConnectionDraft(null);
    setServerToEdit(server);
    setConnModalOpen(true);
  }, [closeSidebarContextMenu]);

  const duplicateSidebarServer = useCallback((server: ConnectionItem) => {
    closeSidebarContextMenu();

    const sourceName = String(server?.name || "").trim();
    const duplicateName = sourceName
      ? `${sourceName} Copy`
      : (settings.lang === 'de' ? 'Neue Verbindung Kopie' : 'New Connection Copy');

    setServerToEdit(null);
    setConnectionDraft({
      name: duplicateName,
      host: String(server?.host || ""),
      port: Number(server?.port) || 22,
      username: String(server?.username || ""),
      private_key: String(server?.private_key || ""),
      group_name: String(server?.group_name || "")
    });
    setConnModalOpen(true);
  }, [closeSidebarContextMenu, settings.lang]);

  const deleteSidebarServer = useCallback((server: ConnectionItem) => {
    closeSidebarContextMenu();
    showDialog({
      type: 'confirm',
      tone: 'danger',
      title: settings.lang === 'de' ? 'Verbindung löschen' : 'Delete connection',
      description:
        settings.lang === 'de'
          ? `Der gespeicherte Servereintrag "${server.name}" wird entfernt.`
          : `This removes the saved server entry "${server.name}".`,
      confirmLabel: settings.lang === 'de' ? 'Löschen' : 'Delete',
      cancelLabel: settings.lang === 'de' ? 'Abbrechen' : 'Cancel',
      onConfirm: async () => {
        try {
          await invoke('delete_connection', { id: server.id, name: server.name });
          await loadServers();
          showToast(settings.lang === 'de' ? 'Verbindung gelöscht' : 'Connection deleted');
        } catch (e) {
          showToast(String(e), true);
        }
      }
    });
  }, [closeSidebarContextMenu, settings.lang, showDialog, loadServers, showToast]);

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

  const duplicateTabSession = (tab: AppTab, paneIndex?: number) => {
    closeTabContextMenu();

    const targetServer =
      typeof paneIndex === 'number' && tab.splitMode
        ? tab.paneServers?.[paneIndex] || null
        : tab;

    if (!targetServer) return;
    void openTerminal(targetServer, { forceNewTab: true });
  };

  const openTabInSplit = (tab: AppTab) => {
    closeTabContextMenu();
    if (tab.splitMode) return;

    setOpenTabs(prev =>
      prev.map(curr =>
        curr.tabId !== tab.tabId
          ? curr
          : buildSplitTabFromServers(curr, curr, curr.tabId, [curr.sessionId], true)
      )
    );
    setActiveTabId(tab.tabId);
  };

  const removeSplitFromTab = (tab: AppTab) => {
    closeTabContextMenu();
    if (!tab.splitMode) return;

    const keepIndex = tab.focusedPaneIndex === 1 ? 1 : 0;
    const removeIndex = keepIndex === 1 ? 0 : 1;
    const removeSessionId = tab.paneSessionIds?.[removeIndex];

    if (removeSessionId) {
      destroyTerminal(String(removeSessionId));
    }

    setOpenTabs(prev =>
      prev.map(curr => {
        if (curr.tabId !== tab.tabId) return curr;

        const keepServer = curr.paneServers?.[keepIndex] || curr;
        const keepSessionId = curr.paneSessionIds?.[keepIndex] || curr.sessionId || curr.tabId;

        return {
          ...keepServer,
          tabId: curr.tabId,
          sessionId: keepSessionId,
          splitMode: false,
          paneServers: undefined,
          paneSessionIds: undefined,
          focusedPaneIndex: undefined
        };
      })
    );
    setActiveTabId(tab.tabId);
  };

  const closeTabFromContextMenu = (tab: AppTab) => {
    closeTabContextMenu();
    closeTab(tab.tabId);
  };

  const updateTabFromPaneState = useCallback((
    tabId: string,
    payload: PaneStatePayload
  ) => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.tabId !== tabId) return tab;

        const rawPaneServers = Array.isArray(payload.paneServers) ? payload.paneServers.slice(0, 2) : [];
        const rawPaneSessionIds = Array.isArray(payload.paneSessionIds) ? payload.paneSessionIds.slice(0, 2) : [];

        const normalizedEntries = rawPaneServers
          .map((server, index) => {
            if (!server) return null;

            const rawSessionId = rawPaneSessionIds[index];
            const sessionId =
              typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
                ? rawSessionId
                : `${tabId}__pane_${index}`;

            return { server, sessionId };
          })
          .filter((entry): entry is { server: ConnectionItem; sessionId: string } => Boolean(entry));

        if (normalizedEntries.length <= 1) {
          const singleEntry = normalizedEntries[0];
          const singleServer = singleEntry?.server || tab.paneServers?.[0] || tab;
          const singleSessionId =
            singleEntry?.sessionId || tab.paneSessionIds?.[0] || tab.sessionId || tab.tabId;

          return {
            ...singleServer,
            tabId,
            sessionId: singleSessionId,
            splitMode: false,
            paneServers: undefined,
            paneSessionIds: undefined,
            focusedPaneIndex: undefined
          };
        }

        const leftEntry = normalizedEntries[0];
        const rightEntry = normalizedEntries[1];

        if (!leftEntry || !rightEntry) {
          return tab;
        }

        const focusedPaneIndex =
          payload.focusedPaneId === rightEntry.sessionId
            ? 1
            : payload.focusedPaneId === leftEntry.sessionId
            ? 0
            : tab.focusedPaneIndex === 1
            ? 1
            : 0;

        return {
          ...leftEntry.server,
          tabId,
          sessionId: leftEntry.sessionId,
          splitMode: true,
          paneServers: [leftEntry.server, rightEntry.server],
          paneSessionIds: [leftEntry.sessionId, rightEntry.sessionId],
          focusedPaneIndex,
          name: `${leftEntry.server?.name || leftEntry.server?.host || 'Left'} | ${rightEntry.server?.name || rightEntry.server?.host || 'Right'}`
        };
      })
    );
  }, []);

    

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
      <GlobalDialog dialog={dialog} onClose={() => setDialog((prev) => ({ ...prev, isOpen: false }))} />

      {startupVaultGateState !== 'open' && (
        <div className="absolute inset-0 z-[290] bg-[color-mix(in_srgb,var(--bg-app)_96%,black)]" />
      )}

      {useCustomLinuxTitlebar && (
        <LinuxTitlebar
          lang={settings.lang}
          appVersion={appVersion}
          isWindowMaximized={isWindowMaximized}
          onStartDrag={() => {
            void invoke('window_start_dragging').catch(() => {})
          }}
          onToggleMaximize={() => {
            void invoke('window_toggle_maximize')
              .then((value) => setIsWindowMaximized(Boolean(value)))
              .catch(() => {})
          }}
          onMinimize={() => {
            void invoke('window_minimize').catch(() => {})
          }}
          onClose={() => {
            void invoke('window_close_main').catch(() => {})
          }}
        />
      )}

      <SidebarShell
        isCollapsed={isSidebarCollapsed}
        width={sidebarWidth}
        useCustomLinuxTitlebar={useCustomLinuxTitlebar}
        lang={settings.lang}
        onGoHome={() => setActiveTabId(null)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleCollapse={toggleSidebarCollapse}
        onStartResize={() => {
          isDragging.current = true
          document.body.style.cursor = 'col-resize'
        }}
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
          onOpenNewConnection={() => {
            setServerToEdit(null)
            setConnectionDraft(null)
            setConnModalOpen(true)
          }}
          onOpenQuickConnect={openQuickConnect}
          onOpenConnection={(server, options) => {
            void openTerminal(server, options)
          }}
          onOpenSidebarContextMenu={openSidebarContextMenu}
          onOpenConnectionSettings={(conn) => {
            setServerToEdit(conn)
            setConnModalOpen(true)
          }}
          onToggleFolder={(group) => {
            setCollapsedFolders({ ...collapsedFolders, [group]: !effectiveFolderCollapsed(group) })
          }}
          onRemoveEmptyFolder={(group) => {
            setSettings({ ...settings, customFolders: settings.customFolders.filter((f) => f !== group) })
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
        onClose={() => {
          setConnModalOpen(false);
          setServerToEdit(null);
          setConnectionDraft(null);
        }}
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
        onClose={() => setIsSettingsOpen(false)}
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
