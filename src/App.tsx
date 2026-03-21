import { useState, useEffect, useRef, useMemo } from 'react';
import { Home, Settings, Server, X, Folder, Terminal as TermIcon, Plus, ChevronRight, ChevronDown, SquarePen, ChevronsLeft, ChevronsRight, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { t } from './lib/i18n';
import { useAppSettings } from './hooks/useAppSettings';
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
import { useInputContextMenu } from './hooks/useInputContextMenu';

const RECENT_CONNECTIONS_STORAGE_KEY = "termina_recent_connections";

export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.get("editor") === "sftp") {
    return <SftpEditorWindow />
  }

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { settings, setSettings } = useAppSettings();

  useEffect(() => {
    invoke("set_tray_visible", { visible: Boolean(settings.closeToTray) }).catch(() => {});
  }, [settings.closeToTray]);
  
  useEffect(() => {
    if (!isSidebarCollapsed) {
      expandedSidebarWidthRef.current = sidebarWidth;
    }
  }, [sidebarWidth, isSidebarCollapsed]);

  const [openTabs, setOpenTabs] = useState<any[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [lastActiveConnectionId, setLastActiveConnectionId] = useState<string | null>(null);
  const [tabDragId, setTabDragId] = useState<string | null>(null);
  const [tabDropId, setTabDropId] = useState<string | null>(null);
  const [tabPointerDragging, setTabPointerDragging] = useState(false);
  const [tabGhostPos, setTabGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [recentConnectionIds, setRecentConnectionIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_CONNECTIONS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
    } catch {
      return [];
    }
  });
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnModalOpen, setConnModalOpen] = useState(false);
  const [serverToEdit, setServerToEdit] = useState<any>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{ x: number; y: number; server: any; isLocal: boolean } | null>(null);

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

  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', placeholder: '', defaultValue: '', isPassword: false, onConfirm: (_v:any)=>{}, onCancel: ()=>{} });
  const showDialog = (config: any) => setDialog(prev => ({ ...prev, isOpen: true, ...config }));

  const isDragging = useRef(false);
  const expandedSidebarWidthRef = useRef(260);
  const settingsRef = useRef(settings);
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const tabDragStartXRef = useRef<number | null>(null);

  const { inputMenu, runInputMenuAction } = useInputContextMenu({
    lang: settings.lang,
    showToast
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const loadServers = async () => {
    try {
      const items = await invoke('get_connections');
      setConnections(Array.isArray(items) ? items : []);
    } catch (e) {
      setConnections([]);
      showToast(
        settings.lang === 'de'
          ? `Verbindungen konnten nicht geladen werden: ${String(e)}`
          : `Could not load connections: ${String(e)}`,
        true
      );
    }
  };
  useEffect(() => { loadServers(); }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(recentConnectionIds));
    } catch {}
  }, [recentConnectionIds]);

  const { groups, rootServers } = useMemo(() => {
    const grps: Record<string, any[]> = {};
    const root: any[] = [];
    (settings.customFolders || []).forEach((f: string) => grps[f] = []);

    connections.forEach((curr: any) => {
      const g = curr.group_name;
      if (!g || g.trim() === '') {
        root.push(curr);
      } else {
        if (!grps[g]) grps[g] = [];
        grps[g].push(curr);
      }
    });
    return { groups: grps, rootServers: root };
  }, [connections, settings.customFolders]);

  const collapsedConnections = useMemo(() => {
    const items: any[] = [
      { id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' }
    ];

    rootServers.forEach((conn: any) => items.push(conn));
    Object.keys(groups).sort().forEach((group) => {
      groups[group].forEach((conn: any) => items.push(conn));
    });

    return items;
  }, [rootServers, groups]);

  const normalizedSidebarSearch = sidebarSearchQuery.trim().toLowerCase();
  const isSidebarSearching = showSidebarSearch && normalizedSidebarSearch.length > 0;

  const matchesSidebarSearch = (conn: any) => {
    if (!normalizedSidebarSearch) return true;
    const haystack = [
      conn?.name || "",
      conn?.host || "",
      conn?.username || ""
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedSidebarSearch);
  };

  const filteredRootServers = useMemo(() => {
    if (!isSidebarSearching) return rootServers;
    return rootServers.filter((conn: any) => matchesSidebarSearch(conn));
  }, [rootServers, isSidebarSearching, normalizedSidebarSearch]);

  const filteredGroups = useMemo(() => {
    if (!isSidebarSearching) return groups;

    const next: Record<string, any[]> = {};
    Object.keys(groups).forEach((group) => {
      const matches = groups[group].filter((conn: any) => matchesSidebarSearch(conn));
      if (matches.length > 0) next[group] = matches;
    });
    return next;
  }, [groups, isSidebarSearching, normalizedSidebarSearch]);

  const sidebarVisibleGroups = isSidebarSearching ? filteredGroups : groups;
  const sidebarVisibleRootServers = isSidebarSearching ? filteredRootServers : rootServers;
  const sidebarSearchLocalVisible = !isSidebarSearching || matchesSidebarSearch({ name: 'Local Terminal', username: 'local', host: 'localhost' });

  const effectiveFolderCollapsed = (group: string) => {
    if (!isSidebarSearching) return Boolean(collapsedFolders[group]);
    return false;
  };

  const activeTab = useMemo(
    () => openTabs.find((tab: any) => tab.tabId === activeTabId) || null,
    [openTabs, activeTabId]
  );

  useEffect(() => {
    if (!activeTab) return;

    if (activeTab.isLocal) {
      setLastActiveConnectionId("__local__");
      return;
    }

    if (activeTab.id != null) {
      setLastActiveConnectionId(String(activeTab.id));
    }
  }, [activeTab]);

  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.isLocal) return;
    if (activeTab.id == null) return;

    const id = String(activeTab.id);
    setRecentConnectionIds((prev) => [id, ...prev.filter((value) => value !== id)].slice(0, 12));
  }, [activeTab]);

  useEffect(() => {
    if (lastActiveConnectionId == null) return;

    const stillOpen = openTabs.some((tab: any) => {
      if (lastActiveConnectionId === "__local__") {
        return !!tab?.isLocal;
      }
      return tab?.id != null && String(tab.id) === String(lastActiveConnectionId);
    });

    if (!stillOpen) {
      setLastActiveConnectionId(null);
    }
  }, [openTabs, lastActiveConnectionId]);

  const activeConnectionId = activeTab?.isLocal ? "__local__" : activeTab?.id != null ? String(activeTab.id) : null;
  const sidebarActiveConnectionId = activeConnectionId ?? lastActiveConnectionId;
  const isLocalActive = sidebarActiveConnectionId === "__local__";
  const isServerActive = (conn: any) => sidebarActiveConnectionId != null && String(sidebarActiveConnectionId) === String(conn.id);
  const draggedTabGhost = useMemo(
    () => openTabs.find((tab: any) => tab.tabId === tabDragId) || null,
    [openTabs, tabDragId]
  );

  const recentConnectionsForDashboard = useMemo(() => {
    if (!recentConnectionIds.length) return connections.slice(0, 6);

    const order = new Map(recentConnectionIds.map((id, index) => [String(id), index]));
    return connections
      .filter((conn: any) => order.has(String(conn.id)))
      .sort((a: any, b: any) => (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999));
  }, [connections, recentConnectionIds]);

  const handleMouseMove = (e: MouseEvent) => { if (isDragging.current) setSidebarWidth(Math.min(Math.max(e.clientX, 200), 600)); };
  const handleMouseUp = () => { isDragging.current = false; document.body.style.cursor = 'default'; };
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  const toggleSidebarCollapse = () => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      setSidebarWidth(expandedSidebarWidthRef.current || 260);
      return;
    }

    expandedSidebarWidthRef.current = sidebarWidth;
    setIsSidebarCollapsed(true);
  };

  const closeSidebarSearch = () => {
    setShowSidebarSearch(false);
    setSidebarSearchQuery("");
  };

  const toggleSidebarSearch = () => {
    if (showSidebarSearch) {
      closeSidebarSearch();
      return;
    }

    setShowSidebarSearch(true);
    window.setTimeout(() => {
      sidebarSearchInputRef.current?.focus();
      sidebarSearchInputRef.current?.select();
    }, 0);
  };

  useEffect(() => {
    if (!showSidebarSearch) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeSidebarSearch();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showSidebarSearch]);

  useEffect(() => {
    if (!isSidebarCollapsed) return;
    if (!showSidebarSearch && !sidebarSearchQuery) return;
    setShowSidebarSearch(false);
    setSidebarSearchQuery("");
  }, [isSidebarCollapsed]);

  const ensureHostKeyTrusted = async (server: any) => {
    const wantsLocal =
      !!server?.isLocal ||
      server?.id === 'local' ||
      server?.name === 'Local Terminal' ||
      server?.host === 'localhost';

    if (wantsLocal) return true;

    try {
      const info = await invoke('check_host_key', {
        host: server.host,
        port: server.port || 22
      }) as any;

      if (info?.status === 'match') {
        return true;
      }

      if (info?.status !== 'not_found' && info?.status !== 'mismatch') {
        showToast(
          settings.lang === 'de'
            ? 'Host-Fingerprint konnte nicht geprüft werden'
            : 'Could not verify host fingerprint',
          true
        );
        return false;
      }

      const isMismatch = info.status === 'mismatch';

      return await new Promise<boolean>((resolve) => {
        showDialog({
          type: 'confirm',
          tone: isMismatch ? 'danger' : undefined,
          title: isMismatch
            ? (settings.lang === 'de' ? 'SSH Host Key geändert' : 'SSH host key changed')
            : (settings.lang === 'de' ? 'Unbekannter SSH Host' : 'Unknown SSH host'),
          description: isMismatch
            ? (
                settings.lang === 'de'
                  ? `Der gespeicherte Host-Fingerprint für ${info.display_host} hat sich geändert.\n\nTyp: ${info.key_type}\nFingerprint: ${info.fingerprint}\n\nDas kann harmlos sein, kann aber auch auf einen Man-in-the-Middle-Angriff hindeuten. Nur fortfahren, wenn du der Änderung wirklich vertraust.`
                  : `The stored host fingerprint for ${info.display_host} has changed.\n\nType: ${info.key_type}\nFingerprint: ${info.fingerprint}\n\nThis can be harmless, but it can also indicate a man-in-the-middle attack. Only continue if you really trust this change.`
              )
            : (
                settings.lang === 'de'
                  ? `Dieser Host ist noch nicht in known_hosts gespeichert.\n\nHost: ${info.display_host}\nTyp: ${info.key_type}\nFingerprint: ${info.fingerprint}\n\nWenn du vertraust, wird der Host in ~/.ssh/known_hosts gespeichert.`
                  : `This host is not stored in known_hosts yet.\n\nHost: ${info.display_host}\nType: ${info.key_type}\nFingerprint: ${info.fingerprint}\n\nIf you trust it, the host will be stored in ~/.ssh/known_hosts.`
              ),
          confirmLabel: isMismatch
            ? (settings.lang === 'de' ? 'Ersetzen und verbinden' : 'Replace and connect')
            : (settings.lang === 'de' ? 'Vertrauen und verbinden' : 'Trust and connect'),
          cancelLabel: settings.lang === 'de' ? 'Abbrechen' : 'Cancel',
          onConfirm: async () => {
            try {
              await invoke('trust_host_key', {
                host: info.host,
                port: info.port
              });
              resolve(true);
            } catch (e) {
              showToast(
                settings.lang === 'de'
                  ? `Host-Fingerprint konnte nicht gespeichert werden: ${String(e)}`
                  : `Could not store host fingerprint: ${String(e)}`,
                true
              );
              resolve(false);
            }
          },
          onCancel: () => resolve(false)
        });
      });
    } catch (e) {
      showToast(
        settings.lang === 'de'
          ? `Host-Fingerprint Prüfung fehlgeschlagen: ${String(e)}`
          : `Host fingerprint check failed: ${String(e)}`,
        true
      );
      return false;
    }
  };

  const needsSessionPasswordPrompt = (server: any) => {
    const wantsLocal =
      !!server?.isLocal ||
      server?.id === 'local' ||
      server?.name === 'Local Terminal' ||
      server?.host === 'localhost';

    if (wantsLocal) return false;
    if (server?.isQuickConnect) return !!server?.quickConnectNeedsPassword;

    return server?.has_password === false && !server?.private_key;
  };

  const openTerminal = async (
    server: any,
    options: { forceNewTab?: boolean; openInSplit?: boolean } = {}
  ) => {
    const findExistingTabId = () => {
      if (options.forceNewTab) return null;
      if (server?.isQuickConnect) return null;

      const wantsLocal =
        !!server?.isLocal ||
        server?.id === 'local' ||
        server?.name === 'Local Terminal' ||
        server?.host === 'localhost';

      if (wantsLocal) {
        const existingLocal = openTabs.find((tab: any) => tab?.isLocal);
        return existingLocal?.tabId || null;
      }

      if (server?.id != null) {
        const existingServer = openTabs.find((tab: any) => String(tab?.id) === String(server.id));
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

    if (needsSessionPasswordPrompt(server)) {
      showDialog({
        type: "prompt",
        title:
          settings.lang === "de"
            ? `Passwort für ${server?.name || server?.host || "SSH Verbindung"}`
            : `Password for ${server?.name || server?.host || "SSH connection"}`,
        placeholder: settings.lang === "de" ? "SSH Passwort eingeben" : "Enter SSH password",
        isPassword: true,
        onConfirm: (pwd: string) => {
          if (!pwd) return;

          const tabId = Math.random().toString(36).substring(7);
          const newTab = {
            ...server,
            sessionPassword: pwd,
            tabId,
            sessionId: tabId
          };
          setOpenTabs(prev => [...prev, newTab]);
          setActiveTabId(tabId);
        }
      });
      return;
    }

    if (server?.isQuickConnect && server?.quickConnectNeedsPassword) {
      showDialog({
        type: "prompt",
        title: settings.lang === "de" ? "Passwort für Quick Connect" : "Password for Quick Connect",
        placeholder: settings.lang === "de" ? "SSH Passwort eingeben" : "Enter SSH password",
        isPassword: true,
        onConfirm: (pwd: string) => {
          const tabId = Math.random().toString(36).substring(7);
          const newTab = {
            ...server,
            password: pwd || "",
            quickConnectNeedsPassword: false,
            tabId,
            sessionId: tabId
          };
          setOpenTabs(prev => [...prev, newTab]);
          setActiveTabId(tabId);
        }
      });
      return;
    }

    const tabId = Math.random().toString(36).substring(7);
    const newTab = { ...server, tabId, sessionId: tabId };
    setOpenTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  const closeSidebarContextMenu = () => {
    setSidebarContextMenu(null);
  };

  const buildSplitTabFromServers = (leftServer: any, rightServer: any, existingTabId?: string) => {
    const tabId = existingTabId || Math.random().toString(36).substring(7);
    const leftSessionId = `${tabId}__pane_0`;
    const rightSessionId = `${tabId}__pane_1`;

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

  const openServerInSplit = async (server: any) => {
    if (!activeTabId) {
      await openTerminal(server);
      return;
    }

    const currentTab = openTabs.find((tab: any) => tab.tabId === activeTabId);
    if (!currentTab) {
      await openTerminal(server);
      return;
    }

    const wantsLocal =
      !!server?.isLocal ||
      server?.id === 'local' ||
      server?.name === 'Local Terminal' ||
      server?.host === 'localhost';

    if (!wantsLocal) {
      if (!(await ensureHostKeyTrusted(server))) {
        return;
      }
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
        onConfirm: (pwd: string) => {
          if (!pwd) return;

          const rightServer = {
            ...server,
            sessionPassword: pwd
          };

          setOpenTabs(prev => {
            const next = [...prev];
            const idx = next.findIndex((tab: any) => tab.tabId === activeTabId);
            if (idx === -1) return prev;

            const baseTab = next[idx];
            const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab;
            next[idx] = buildSplitTabFromServers(leftServer, rightServer, activeTabId);
            return next;
          });

          setActiveTabId(activeTabId);
        }
      });
      return;
    }

    if (server?.isQuickConnect && server?.quickConnectNeedsPassword) {
      showDialog({
        type: "prompt",
        title: settings.lang === "de" ? "Passwort für Quick Connect" : "Password for Quick Connect",
        placeholder: settings.lang === "de" ? "SSH Passwort eingeben" : "Enter SSH password",
        isPassword: true,
        onConfirm: (pwd: string) => {
          const rightServer = {
            ...server,
            password: pwd || "",
            quickConnectNeedsPassword: false
          };

          setOpenTabs(prev => {
            const next = [...prev];
            const idx = next.findIndex((tab: any) => tab.tabId === activeTabId);
            if (idx === -1) return prev;

            const baseTab = next[idx];
            const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab;
            next[idx] = buildSplitTabFromServers(leftServer, rightServer, activeTabId);
            return next;
          });

          setActiveTabId(activeTabId);
        }
      });
      return;
    }

    setOpenTabs(prev => {
      const next = [...prev];
      const idx = next.findIndex((tab: any) => tab.tabId === activeTabId);
      if (idx === -1) return prev;

      const baseTab = next[idx];
      const leftServer = baseTab?.splitMode ? baseTab.paneServers?.[0] || baseTab : baseTab;
      next[idx] = buildSplitTabFromServers(leftServer, server, activeTabId);
      return next;
    });

    setActiveTabId(activeTabId);
  };

  const openSidebarContextMenu = (e: React.MouseEvent, server: any, isLocal = false) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarContextMenu({
      x: e.clientX,
      y: e.clientY,
      server,
      isLocal
    });
  };

  const editSidebarServer = (server: any) => {
    closeSidebarContextMenu();
    setServerToEdit(server);
    setConnModalOpen(true);
  };

  const deleteSidebarServer = (server: any) => {
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
  };

  const closeTab = (tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.tabId !== tabId);
      if (activeTabId === tabId) setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].tabId : null);
      return newTabs;
    });
  };

  const updateTabFromPaneState = (
    tabId: string,
    payload: {
      paneServers: any[];
      paneSessionIds: string[];
      focusedPaneId?: string | null;
    }
  ) => {
    setOpenTabs((prev) =>
      prev.map((tab: any) => {
        if (tab.tabId !== tabId) return tab;

        const paneServers = Array.isArray(payload.paneServers) ? payload.paneServers.filter(Boolean) : [];
        const paneSessionIds = Array.isArray(payload.paneSessionIds) ? payload.paneSessionIds.filter(Boolean) : [];

        if (paneServers.length <= 1) {
          const singleServer = paneServers[0] || tab.paneServers?.[0] || tab;
          const singleSessionId = paneSessionIds[0] || tab.paneSessionIds?.[0] || tab.sessionId || tab.tabId;

          return {
            ...singleServer,
            tabId,
            sessionId: singleSessionId
          };
        }

        const leftServer = paneServers[0];
        const rightServer = paneServers[1];

        return {
          ...leftServer,
          tabId,
          sessionId: paneSessionIds[0] || `${tabId}__pane_0`,
          splitMode: true,
          paneServers: [leftServer, rightServer],
          paneSessionIds: [
            paneSessionIds[0] || `${tabId}__pane_0`,
            paneSessionIds[1] || `${tabId}__pane_1`
          ],
          focusedPaneIndex:
            payload.focusedPaneId && paneSessionIds[1] === payload.focusedPaneId ? 1 : 0,
          name: `${leftServer?.name || leftServer?.host || 'Left'} | ${rightServer?.name || rightServer?.host || 'Right'}`
        };
      })
    );
  };

  const clearTabPointerState = () => {
    setTabDragId(null);
    setTabDropId(null);
    setTabPointerDragging(false);
    setTabGhostPos(null);
    tabDragStartXRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const handleTabPointerStart = (e: any, tabId: string) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-no-tab-drag="true"]')) return;

    setTabDragId(tabId);
    setTabDropId(tabId);
    setTabPointerDragging(false);
    setTabGhostPos({ x: e.clientX, y: e.clientY });
    tabDragStartXRef.current = e.clientX;
    document.body.style.userSelect = 'none';
  };

  const handleTabPointerEnter = (tabId: string) => {
    if (!tabDragId) return;
    if (!tabPointerDragging) return;
    if (tabId === tabDragId) return;
    setTabDropId(tabId);
  };

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
          const fromIndex = prev.findIndex((tab: any) => tab.tabId === tabDragId);
          const toIndex = prev.findIndex((tab: any) => tab.tabId === tabDropId);

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
  }, [tabDragId, tabDropId, tabPointerDragging]);

    

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden relative">
      <GlobalDialog dialog={dialog} onClose={() => setDialog({...dialog, isOpen: false})} />

      <div style={{ width: isSidebarCollapsed ? 76 : sidebarWidth }} className="bg-[color-mix(in_srgb,var(--bg-sidebar)_94%,var(--bg-app))] flex flex-col flex-shrink-0 h-full relative z-20 shadow-xl">
        {isSidebarCollapsed ? (
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="flex justify-center">
              <button
                onClick={() => setActiveTabId(null)}
                className="ui-icon-btn shrink-0"
                title="Home"
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
            <button onClick={() => setActiveTabId(null)} className="ui-icon-btn shrink-0 justify-self-end" title="Home">
              <Home size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2 px-3 flex flex-col gap-3 min-h-0">
          <div>
            <div className={`flex items-center px-2 py-1 mb-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
              {!isSidebarCollapsed && (
                <h3 className="text-[11px] uppercase tracking-[0.08em] font-bold text-[var(--text-muted)] w-full py-1">
                  {t('connections', settings.lang)}
                </h3>
              )}
              <div className="flex gap-1">
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
                  onClick={() => { setServerToEdit(null); setConnModalOpen(true); }}
                  className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                  title={t('newConn', settings.lang)}
                >
                  <Plus size={16} />
                </button>
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
                {collapsedConnections.map((conn: any, idx: number) => {
                  const localItem = !!conn?.isLocal || conn?.id === 'local'
                  const active = localItem ? isLocalActive : isServerActive(conn)

                  return (
                    <button
                      key={`${conn.id || conn.name || 'item'}_${idx}`}
                      onContextMenu={(e) => openSidebarContextMenu(e, localItem ? { id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' } : conn, localItem)}
                      onClick={() => void openTerminal(localItem ? { id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' } : conn)}
                      onDoubleClick={() => void openTerminal(localItem ? { id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' } : conn, { forceNewTab: true })}
                      title={conn.name}
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
                {sidebarSearchLocalVisible && (
                  <div
                    className={`group/item flex items-center justify-between w-full rounded-xl border text-sm transition-all px-2 py-0 ${
                      isLocalActive
                        ? 'bg-[color-mix(in_srgb,var(--bg-hover)_72%,transparent)] border-[color-mix(in_srgb,var(--accent)_26%,var(--border-subtle))]'
                        : 'border-transparent hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)]'
                    }`}
                  >
                    <button
                      onContextMenu={(e) => openSidebarContextMenu(e, { id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' }, true)}
                      onClick={() => void openTerminal({ id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' })}
                      onDoubleClick={() => void openTerminal({ id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' }, { forceNewTab: true })}
                      className={`flex items-center flex-1 min-w-0 text-left py-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-hover)] ${
                        isLocalActive ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-center w-6 h-6 rounded-md border mr-2 shrink-0 ${
                          isLocalActive
                            ? 'bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-app))] border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))]'
                            : 'bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border-[var(--border-subtle)]'
                        }`}
                      >
                        <TermIcon size={12} className={isLocalActive ? "text-[var(--accent)]" : "text-[var(--text-category)]"} />
                      </div>
                      <span className="truncate font-medium min-w-0">Local Terminal</span>
                    </button>
                  </div>
                )}

                {sidebarVisibleRootServers.length === 0 && Object.keys(sidebarVisibleGroups).length === 0 && !sidebarSearchLocalVisible && (
                  <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-4 py-5 text-center">
                    <div className="text-sm font-semibold text-[var(--text-main)]">
                      {t('noConnectionsYet', settings.lang)}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                      {t('noConnectionsHint', settings.lang)}
                    </div>
                  </div>
                )}

                {sidebarVisibleRootServers.map((conn: any) => {
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
                        className="flex items-center justify-between px-2.5 py-0.5 w-full rounded-xl border border-transparent transition-all group/folder mt-1 hover:bg-[var(--bg-hover)] hover:border-[var(--border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 text-[var(--text-muted)]">
                          {isCollapsed ? <ChevronRight size={12} className="text-[var(--accent)] shrink-0" /> : <ChevronDown size={12} className="text-[var(--accent)] shrink-0" />}
                          <Folder size={12} className="text-[var(--accent)] shrink-0" />
                          <span className="truncate text-[10px] font-semibold min-w-0 text-[var(--text-muted)]">{group}</span>
                        </div>
                        {!isSidebarSearching && groups[group].length === 0 && (
                           <span
                             onClick={(e) => { e.stopPropagation(); setSettings({...settings, customFolders: settings.customFolders.filter((f:string)=>f!==group)}); }}
                             className="opacity-0 group-hover/folder:opacity-100 text-[var(--danger)] transition-all focus-visible:opacity-100 flex items-center justify-center shrink-0"
                             style={{ width: 18, height: 18, borderRadius: 6 }}
                           >
                             <X size={10}/>
                           </span>
                        )}
                      </button>
                      {!isCollapsed && (
                        <div className="flex flex-col gap-0 ml-3 border-l border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] pl-2 mt-0.5">
                          {sidebarVisibleGroups[group].map((conn: any) => {
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
                ? (settings.lang === 'de' ? 'Sidebar ausklappen' : 'Expand sidebar')
                : (settings.lang === 'de' ? 'Sidebar einklappen' : 'Collapse sidebar')}
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

      <div className="flex-1 flex flex-col h-full relative z-10 min-w-0">
        {activeTabId && (
          <div className="h-10 flex bg-[color-mix(in_srgb,var(--bg-sidebar)_96%,var(--bg-app))] border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] shrink-0">
            <div className="flex overflow-x-auto h-full scrollbar-hide w-full items-end pt-1 px-2 gap-1.5">
              {openTabs.map((tab) => {
                const dragIndex = tabDragId ? openTabs.findIndex((t: any) => t.tabId === tabDragId) : -1
                const dropIndex = tabDropId ? openTabs.findIndex((t: any) => t.tabId === tabDropId) : -1
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
                activeTabs={openTabs}
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
                   onPaneStateChange={(payload: any) => updateTabFromPaneState(tab.tabId, payload)}
                   isActive={activeTabId === tab.tabId}
                   showDialog={showDialog}
                 />
              </div>
           ))}
        </div>
      </div>

      {sidebarContextMenu && (
        <div className="fixed inset-0 z-[260]" onMouseDown={closeSidebarContextMenu}>
          <div
            className="fixed w-[220px] rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] shadow-2xl p-2 flex flex-col gap-1"
            style={{
              left: Math.max(8, Math.min(sidebarContextMenu.x, window.innerWidth - 228)),
              top: Math.max(8, Math.min(sidebarContextMenu.y, window.innerHeight - (sidebarContextMenu.isLocal ? 108 : 176)))
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              onClick={() => {
                closeSidebarContextMenu();
                void openTerminal(sidebarContextMenu.server);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              {sidebarContextMenu.isLocal ? <TermIcon size={14} /> : <Server size={14} />}
              <span>{settings.lang === 'de' ? 'Öffnen' : 'Open'}</span>
            </button>

            <button
              onClick={() => {
                closeSidebarContextMenu();
                void openTerminal(sidebarContextMenu.server, { forceNewTab: true });
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus size={14} />
              <span>{settings.lang === 'de' ? 'In neuem Tab öffnen' : 'Open in new tab'}</span>
            </button>

            <button
              onClick={() => {
                closeSidebarContextMenu();
                void openTerminal(sidebarContextMenu.server, { openInSplit: true });
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Folder size={14} />
              <span>{settings.lang === 'de' ? 'Im Split öffnen' : 'Open in split'}</span>
            </button>

            {!sidebarContextMenu.isLocal && (
              <>
                <div className="h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] my-1" />

                <button
                  onClick={() => editSidebarServer(sidebarContextMenu.server)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <SquarePen size={14} />
                  <span>{settings.lang === 'de' ? 'Bearbeiten' : 'Edit'}</span>
                </button>

                <button
                  onClick={() => deleteSidebarServer(sidebarContextMenu.server)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[var(--danger)] hover:text-white hover:bg-[var(--danger)] transition-colors"
                >
                  <X size={14} />
                  <span>{settings.lang === 'de' ? 'Löschen' : 'Delete'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <ConnectionModal isOpen={isConnModalOpen} onClose={() => setConnModalOpen(false)} serverToEdit={serverToEdit} onSuccess={loadServers} showToast={showToast} showDialog={showDialog} lang={settings.lang} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} setSettings={setSettings} showToast={showToast} showDialog={showDialog} />

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

      <InputContextMenu
        inputMenu={inputMenu}
        lang={settings.lang}
        onAction={runInputMenuAction}
      />

      <ToastStack toasts={toasts} />
    </div>
  );
}
