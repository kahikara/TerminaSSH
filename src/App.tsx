import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Home, Settings, Server, X, Folder, Terminal as TermIcon, Plus, ChevronRight, ChevronDown, SquarePen, ChevronsLeft, ChevronsRight, Search, Minus, Square, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { t } from './lib/i18n';
import type { GlobalDialogState } from './lib/types';
import { useAppSettings } from './hooks/useAppSettings';
import { useStartupVaultGate } from './hooks/useStartupVaultGate';
import { useConnectionHelpers } from './hooks/useConnectionHelpers';
import { useVaultConnectionUnlock } from './hooks/useVaultConnectionUnlock';
import { useHostKeyTrust } from './hooks/useHostKeyTrust';
import { useConnectionCollections } from './hooks/useConnectionCollections';
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
  const [tabDragId, setTabDragId] = useState<string | null>(null);
  const [tabDropId, setTabDropId] = useState<string | null>(null);
  const [tabPointerDragging, setTabPointerDragging] = useState(false);
  const [tabGhostPos, setTabGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [isQuickConnectOpen, setQuickConnectOpen] = useState(false);
  const [quickConnectDraft, setQuickConnectDraft] = useState({ user: "", host: "", port: "22" });
  
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
  const tabDragStartXRef = useRef<number | null>(null);

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
    if (!isQuickConnectOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setQuickConnectOpen(false);
      setQuickConnectDraft({ user: "", host: "", port: "22" });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isQuickConnectOpen]);

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

  const closeQuickConnect = () => {
    setQuickConnectOpen(false);
    setQuickConnectDraft({ user: "", host: "", port: "22" });
  };

  const submitQuickConnect = (e?: React.FormEvent) => {
    e?.preventDefault();

    const host = quickConnectDraft.host.trim();
    const username = quickConnectDraft.user.trim();
    const parsedPort = parseInt(quickConnectDraft.port.trim() || "22", 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 22;

    if (!host) return;

    closeQuickConnect();
    void openTerminal({
      isQuickConnect: true,
      quickConnectNeedsPassword: true,
      name: host,
      username,
      host,
      port
    });
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

  const clearTabPointerState = useCallback(() => {
    setTabDragId(null);
    setTabDropId(null);
    setTabPointerDragging(false);
    setTabGhostPos(null);
    tabDragStartXRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const handleTabPointerStart = useCallback((e: React.MouseEvent<HTMLDivElement>, tabId: string) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-no-tab-drag="true"]')) return;

    setTabDragId(tabId);
    setTabDropId(tabId);
    setTabPointerDragging(false);
    setTabGhostPos({ x: e.clientX, y: e.clientY });
    tabDragStartXRef.current = e.clientX;
    document.body.style.userSelect = 'none';
  }, []);

  const handleTabPointerEnter = useCallback((tabId: string) => {
    if (!tabDragId) return;
    if (!tabPointerDragging) return;
    if (tabId === tabDragId) return;
    setTabDropId(tabId);
  }, [tabDragId, tabPointerDragging]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!tabDragId) return;
      if (tabDragStartXRef.current == null) return;

      if (!tabPointerDragging) {
        if (Math.abs(e.clientX - tabDragStartXRef.current) < 5) return;
        setTabPointerDragging(true);
        document.body.style.cursor = 'grabbing';
      }

      setTabGhostPos({ x: e.clientX, y: e.clientY });
    };

    const onUp = () => {
      if (!tabDragId) return;

      if (tabPointerDragging && tabDropId && tabDropId !== tabDragId) {
        setOpenTabs(prev => {
          const fromIndex = prev.findIndex((tab) => tab.tabId === tabDragId);
          const toIndex = prev.findIndex((tab) => tab.tabId === tabDropId);

          if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;

          const next = [...prev];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return prev;
          next.splice(toIndex, 0, moved);
          return next;
        });
      }

      clearTabPointerState();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [tabDragId, tabDropId, tabPointerDragging, clearTabPointerState]);

    

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
        <>
          <div
            className="absolute top-0 left-0 right-0 z-[300] h-[30px] flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_96%,var(--bg-app))] px-2 select-none"
            onDoubleClick={(e) => {
              const target = e.target as HTMLElement | null
              if (target?.closest('[data-window-control="true"]')) return
              e.preventDefault()
              e.stopPropagation()
              void invoke('window_toggle_maximize')
                .then((value) => setIsWindowMaximized(Boolean(value)))
                .catch(() => {})
            }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement | null
              if (target?.closest('[data-window-control="true"]')) return
              if (e.detail > 1) return
              void invoke('window_start_dragging').catch(() => {})
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <img
                src="/app-icon.svg"
                alt="logo"
                className="w-4 h-4 object-contain shrink-0"
                onError={(e) => e.currentTarget.style.display = 'none'}
              />
              <span className="text-[11px] font-semibold text-[var(--text-main)] truncate">
                Termina SSH{appVersion ? ` v${appVersion}` : ""}
              </span>
            </div>

            <div className="flex items-center gap-[5px]">
              <button
                data-window-control="true"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  void invoke('window_minimize').catch(() => {})
                }}
                className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                title={settings.lang === 'de' ? 'Minimieren' : 'Minimize'}
              >
                <Minus size={11} />
              </button>

              <button
                data-window-control="true"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  void invoke('window_toggle_maximize')
                    .then((value) => setIsWindowMaximized(Boolean(value)))
                    .catch(() => {})
                }}
                className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                title={settings.lang === 'de' ? 'Maximieren' : 'Maximize'}
              >
                <Square size={9.5} className={isWindowMaximized ? 'scale-90' : ''} />
              </button>

              <button
                data-window-control="true"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  void invoke('window_close_main').catch(() => {})
                }}
                className="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-muted)] hover:bg-[var(--danger)] hover:text-white transition-colors shrink-0"
                title={settings.lang === 'de' ? 'Schließen' : 'Close'}
              >
                <X size={11} />
              </button>
            </div>
          </div>
        </>
      )}

      <div
        style={{
          width: isSidebarCollapsed ? 76 : sidebarWidth,
          paddingTop: useCustomLinuxTitlebar ? 30 : 0
        }}
        className="bg-[color-mix(in_srgb,var(--bg-sidebar)_94%,var(--bg-app))] flex flex-col flex-shrink-0 h-full relative z-20 shadow-xl"
      >
        {isSidebarCollapsed ? (
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="flex justify-center">
              <button
                onClick={() => setActiveTabId(null)}
                className="ui-icon-btn shrink-0"
                title={t('home', settings.lang)}
              >
                <Home size={18} />
              </button>
            </div>
          </div>
        ) : (
          <div className="h-[80px] grid grid-cols-[52px_minmax(0,1fr)_36px] items-center px-4 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
            <img
              src="/app-icon.svg"
              alt="logo"
              className="w-[52px] h-[52px] object-contain justify-self-start"
              onError={(e) => e.currentTarget.style.display = 'none'}
            />
            <div className="flex items-center justify-center min-w-0">
              <span className="font-bold tracking-wide text-[14px] text-[var(--text-main)] leading-none text-center">
                Termina SSH
              </span>
            </div>
            <button onClick={() => setActiveTabId(null)} className="ui-icon-btn shrink-0 justify-self-end" title={t('home', settings.lang)}>
              <Home size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2 px-3 flex flex-col gap-3 min-h-0">
          <div>
            <div className={`flex items-center px-2 py-1 mb-2 rounded-xl ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
              {!isSidebarCollapsed && (
                <h3 className="text-[11px] uppercase tracking-[0.08em] font-bold text-[var(--text-muted)] w-full py-1">
                  {t('connections', settings.lang)}
                </h3>
              )}
              <div className="flex gap-1">
                {!isSidebarCollapsed && (
                  <button
                    onClick={() => void openTerminal(LOCAL_TERMINAL_CONNECTION, { forceNewTab: true })}
                    className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                    title={t('localTerminal', settings.lang)}
                  >
                    <TermIcon size={16} />
                  </button>
                )}
                {!isSidebarCollapsed && (
                  <button
                    onClick={toggleSidebarSearch}
                    className={`text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)] ${showSidebarSearch ? 'text-[var(--accent)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))]' : ''}`}
                    title={settings.lang === 'de' ? 'Suche' : 'Search'}
                  >
                    <Search size={16} />
                  </button>
                )}
                <button
                  onClick={() => { setServerToEdit(null); setConnectionDraft(null); setConnModalOpen(true); }}
                  className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                  title={t('newConn', settings.lang)}
                >
                  <Plus size={16} />
                </button>
                {!isSidebarCollapsed && (
                  <button
                    onClick={() => setQuickConnectOpen(true)}
                    className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                    title={t('quickConnect', settings.lang)}
                  >
                    <Zap size={15} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </div>

            {!isSidebarCollapsed && showSidebarSearch && (
              <div className="mb-3 px-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
                    <Search size={14} />
                  </span>
                  <input
                    ref={sidebarSearchInputRef}
                    value={sidebarSearchQuery}
                    onChange={(e) => setSidebarSearchQuery(e.target.value)}
                    placeholder={settings.lang === 'de' ? 'Verbindungen suchen' : 'Search connections'}
                    className="w-full h-9 pl-9 pr-9 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] text-[var(--text-main)] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)] placeholder:text-[var(--text-muted)]"
                  />
                  {sidebarSearchQuery && (
                    <button
                      onClick={() => setSidebarSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded transition-colors"
                      title={settings.lang === 'de' ? 'Leeren' : 'Clear'}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {isSidebarCollapsed ? (
              <div className="flex flex-col items-center gap-1.5 rounded-xl">
                {collapsedConnections.map((conn, idx: number) => {
                  const localItem = !!conn?.isLocal || conn?.id === 'local'
                  const active = localItem ? isLocalActive : isServerActive(conn)

                  return (
                    <button
                      key={`${conn.id || conn.name || 'item'}_${idx}`}
                      onContextMenu={(e) => openSidebarContextMenu(e, localItem ? LOCAL_TERMINAL_CONNECTION : conn, localItem)}
                      onClick={() => void openTerminal(localItem ? LOCAL_TERMINAL_CONNECTION : conn)}
                      onDoubleClick={() => void openTerminal(localItem ? LOCAL_TERMINAL_CONNECTION : conn, { forceNewTab: true })}
                      title={localItem ? t('localTerminal', settings.lang) : conn.name}
                      className={`group/item flex items-center justify-center w-full h-9 rounded-xl border transition-all ${
                        active
                          ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                          : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-center w-6 h-6 rounded-md border shrink-0 ${
                          active
                            ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                            : 'bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border-[var(--border-subtle)]'
                        }`}
                      >
                        {localItem ? (
                          <TermIcon size={12} className={active ? "text-[var(--accent)]" : "text-[var(--text-category)]"} />
                        ) : (
                          <Server size={12} className={active ? "text-[var(--accent)]" : "text-[var(--text-category)]"} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 rounded-xl">
                {sidebarVisibleRootServers.length === 0 && Object.keys(sidebarVisibleGroups).length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-4 py-5 text-center">
                    <div className="text-sm font-semibold text-[var(--text-main)]">
                      {t('noConnectionsYet', settings.lang)}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                      {t('noConnectionsHint', settings.lang)}
                    </div>
                  </div>
                )}

                {sidebarVisibleRootServers.map((conn) => {
                  const active = isServerActive(conn);

                  return (
                    <div
                      key={conn.id}
                      className={`group/item flex items-center justify-between w-full rounded-xl border text-sm transition-all px-2 py-0 ${
                        active
                          ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                          : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                      }`}
                    >
                      <button
                        onContextMenu={(e) => openSidebarContextMenu(e, conn)}
                        onClick={() => void openTerminal(conn)}
                        onDoubleClick={() => void openTerminal(conn, { forceNewTab: true })}
                        className={`flex items-center flex-1 min-w-0 text-left py-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-hover)] ${
                          active ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        <div
                          className={`flex items-center justify-center w-6 h-6 rounded-md border mr-2 shrink-0 ${
                            active
                              ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                              : 'bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border-[var(--border-subtle)]'
                          }`}
                        >
                          <Server size={12} className={active ? "text-[var(--accent)]" : "text-[var(--text-category)]"} />
                        </div>
                        <span className="truncate font-medium min-w-0">{conn.name}</span>
                      </button>
                      <button
                        onClick={() => { setServerToEdit(conn); setConnModalOpen(true); }}
                        className={`${active ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'} ui-icon-btn shrink-0 transition-all focus-visible:opacity-100`}
                        title={t('settings', settings.lang)}
                      >
                        <SquarePen size={13} />
                      </button>
                    </div>
                  );
                })}

                {Object.keys(sidebarVisibleGroups).sort().map(group => {
                  const isCollapsed = effectiveFolderCollapsed(group);
                  return (
                    <div key={group}>
                      <button
                        onClick={() => setCollapsedFolders({...collapsedFolders, [group]: !isCollapsed})}
                        className="inline-flex max-w-full items-center justify-between px-2.5 py-0.5 rounded-xl border border-transparent transition-all group/folder mt-1 hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 text-[var(--text-muted)]">
                          {isCollapsed ? <ChevronRight size={12} className="text-[var(--accent)] shrink-0" /> : <ChevronDown size={12} className="text-[var(--accent)] shrink-0" />}
                          <Folder size={12} className="text-[var(--accent)] shrink-0" />
                          <span className="truncate text-[10px] font-semibold min-w-0 text-[var(--text-muted)]">{group}</span>
                        </div>
                        {!isSidebarSearching && groups[group].length === 0 && (
                           <span
                             onClick={(e) => { e.stopPropagation(); setSettings({...settings, customFolders: settings.customFolders.filter((f) => f !== group)}); }}
                             className="opacity-0 group-hover/folder:opacity-100 text-[var(--danger)] transition-all focus-visible:opacity-100 flex items-center justify-center shrink-0"
                             style={{ width: 18, height: 18, borderRadius: 6 }}
                           >
                             <X size={10}/>
                           </span>
                        )}
                      </button>
                      {!isCollapsed && (
                        <div className="flex flex-col gap-0 ml-3 border-l border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] pl-2 mt-0.5">
                          {sidebarVisibleGroups[group].map((conn) => {
                            const active = isServerActive(conn);

                            return (
                              <div
                                key={conn.id}
                                className={`group/item flex items-center justify-between w-full rounded-xl border text-sm transition-all px-1.5 py-0 ${
                                  active
                                    ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                                    : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                                }`}
                              >
                                <button
                                  onContextMenu={(e) => openSidebarContextMenu(e, conn)}
                                  onClick={() => void openTerminal(conn)}
                                  onDoubleClick={() => void openTerminal(conn, { forceNewTab: true })}
                                  className={`flex items-center flex-1 min-w-0 text-left px-1 py-1 rounded-xl ${
                                    active ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                                  }`}
                                >
                                  <div
                                    className={`flex items-center justify-center w-6 h-6 rounded-md border mr-2 shrink-0 ${
                                      active
                                        ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                                        : 'bg-[var(--bg-app)] border-[var(--border-subtle)]'
                                    }`}
                                  >
                                    <Server size={12} className={active ? "text-[var(--accent)]" : "text-[var(--text-category)]"} />
                                  </div>
                                  <span className="truncate font-medium min-w-0">{conn.name}</span>
                                </button>
                                <button
                                  onClick={() => { setServerToEdit(conn); setConnModalOpen(true); }}
                                  className={`${active ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'} ui-icon-btn shrink-0 transition-all`}
                                  title={t('settings', settings.lang)}
                                >
                                  <SquarePen size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="p-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
          <div className={`flex ${isSidebarCollapsed ? 'flex-col items-center gap-2' : 'items-center gap-2'}`}>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={isSidebarCollapsed
                ? "ui-icon-btn shrink-0"
                : "flex items-center justify-center gap-2.5 flex-1 min-h-9 px-3 rounded-xl bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
              }
              title={t('settings', settings.lang)}
            >
              <Settings size={16} />
              {!isSidebarCollapsed && <span>{t('settings', settings.lang)}</span>}
            </button>

            <button
              onClick={toggleSidebarCollapse}
              className="ui-icon-btn shrink-0"
              title={isSidebarCollapsed
                ? t('sidebarExpand', settings.lang)
                : t('sidebarCollapse', settings.lang)}
            >
              {isSidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            </button>
          </div>
        </div>

        {!isSidebarCollapsed && (
          <div className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10" onMouseDown={() => { isDragging.current = true; document.body.style.cursor = 'col-resize'; }} />
        )}
        <div className="absolute top-0 right-0 w-[1px] h-full bg-[var(--border-subtle)] pointer-events-none" />
      </div>

      <div
        style={{ paddingTop: useCustomLinuxTitlebar ? 30 : 0 }}
        className="flex-1 flex flex-col h-full relative z-10 min-w-0"
      >
        {activeTabId && (
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
                    onMouseDown={e => handleTabPointerStart(e, tab.tabId)}
                    onMouseEnter={() => handleTabPointerEnter(tab.tabId)}
                    onClick={() => setActiveTabId(tab.tabId)}
                    onContextMenu={(e) => openTabContextMenu(e, tab.tabId)}
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
                      onClick={(e) => closeTab(tab.tabId, e)}
                      className="p-1 rounded-full hover:bg-[var(--danger)] hover:text-white text-[var(--text-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-app)]"
                    >
                      <X size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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

      {tabPointerDragging && draggedTabGhost && tabGhostPos && (
        <div
          className="fixed z-[240] pointer-events-none"
          style={{
            left: tabGhostPos.x,
            top: tabGhostPos.y,
            transform: 'translate(-50%, -50%)'
          }}
        >
          <div className="flex items-center px-3.5 h-[32px] min-w-[136px] max-w-[196px] rounded-t-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] text-[var(--text-main)] shadow-2xl opacity-95">
            <span className="truncate flex-1 min-w-0 text-[13px] font-medium">
              {draggedTabGhost.name}
            </span>
          </div>
        </div>
      )}
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
