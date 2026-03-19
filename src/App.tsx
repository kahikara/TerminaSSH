import React from "react";
import { useState, useEffect, useRef, useMemo } from 'react';
import { Home, Settings, Server, X, Folder, Terminal as TermIcon, Plus, ChevronRight, ChevronDown, SquarePen, ChevronsLeft, ChevronsRight, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { t } from './lib/i18n';
import SettingsModal from './components/SettingsModal';
import TerminalPane from './components/TerminalPane';
import SftpEditorWindow from "./components/SftpEditorWindow";
import ConnectionModal from './components/ConnectionModal';
import Dashboard from './components/Dashboard';
import GlobalDialog from './components/GlobalDialog';

type EditorWindowInfo = {
  label: string
  fileName: string
  remotePath: string
  dirty: boolean
}

export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.get("editor") === "sftp") {
    return <SftpEditorWindow />
  }

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [settings, setSettings] = useState(() => {
    const defaults = {
      lang: 'en',
      theme: 'catppuccin',
      fontSize: 14,
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollback: 10000,
      sftpHidden: false,
      sftpSort: 'folders',
      showSplit: true,
      showSftp: true,
      showTunnels: true,
      showSearch: true,
      showDashboardQuickConnect: true,
      showDashboardWorkflow: true,
      showDashboardActiveSessions: true,
      showDashboardRecentConnections: true,
      closeToTray: false,
      customFolders: []
    };

    try {
      const saved = localStorage.getItem('termina_settings');
      if (!saved) return defaults;

      const parsed = JSON.parse(saved);

      let normalizedSort = parsed.sftpSort;
      if (normalizedSort === 'az') normalizedSort = 'name';
      if (normalizedSort === 'za') normalizedSort = 'name';
      if (!['folders', 'name', 'size', 'type'].includes(normalizedSort)) normalizedSort = 'folders';

      return {
        ...defaults,
        ...parsed,
        sftpSort: normalizedSort,
        showSplit: parsed.showSplit !== false,
        showSftp: parsed.showSftp !== false,
        showTunnels: parsed.showTunnels !== false,
        showSearch: parsed.showSearch !== false,
        showDashboardQuickConnect: parsed.showDashboardQuickConnect !== false,
        showDashboardWorkflow: parsed.showDashboardWorkflow !== false,
        showDashboardActiveSessions: parsed.showDashboardActiveSessions !== false,
        showDashboardRecentConnections: parsed.showDashboardRecentConnections !== false,
        closeToTray: parsed.closeToTray === true,
        customFolders: Array.isArray(parsed.customFolders) ? parsed.customFolders : []
      };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    localStorage.setItem('termina_settings', JSON.stringify(settings));
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings]);

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
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnModalOpen, setConnModalOpen] = useState(false);
  const [serverToEdit, setServerToEdit] = useState<any>(null);

  const [toasts, setToasts] = useState<{id: number, msg: string, isErr: boolean}[]>([]);
  const showToast = (msg: string, isErr = false) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, isErr }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', placeholder: '', defaultValue: '', isPassword: false, onConfirm: (_v:any)=>{}, onCancel: ()=>{} });
  const showDialog = (config: any) => setDialog({ ...dialog, isOpen: true, ...config });

  const [inputMenu, setInputMenu] = useState<{
    open: boolean
    x: number
    y: number
    target: HTMLInputElement | HTMLTextAreaElement | null
  }>({
    open: false,
    x: 0,
    y: 0,
    target: null
  });

  const [editorWindows, setEditorWindows] = useState<EditorWindowInfo[]>([]);
  const [mainCloseDialogOpen, setMainCloseDialogOpen] = useState(false);
  const [mainCloseDialogBusy, setMainCloseDialogBusy] = useState(false);
  const [sessionCloseDialogOpen, setSessionCloseDialogOpen] = useState(false);

  const isDragging = useRef(false);
  const expandedSidebarWidthRef = useRef(260);
  const settingsRef = useRef(settings);
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const mainClosingRef = useRef(false);
  const mainWaitingForEditorsRef = useRef(false);
  const openTabsRef = useRef<any[]>([]);
  const editorWindowsRef = useRef<EditorWindowInfo[]>([]);
  const mainCloseDialogBusyRef = useRef(false);
  const tabDragStartXRef = useRef<number | null>(null);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    editorWindowsRef.current = editorWindows;
  }, [editorWindows]);

  useEffect(() => {
    mainCloseDialogBusyRef.current = mainCloseDialogBusy;
  }, [mainCloseDialogBusy]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const closeInputMenu = () => {
    setInputMenu({ open: false, x: 0, y: 0, target: null });
  };

  const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
    if (!el) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;

    const blocked = new Set([
      'checkbox',
      'radio',
      'button',
      'submit',
      'reset',
      'file',
      'color',
      'range',
      'date',
      'datetime-local',
      'month',
      'time',
      'week',
      'hidden',
      'image'
    ]);

    return !blocked.has(el.type);
  };

  const replaceInputSelection = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const nextValue = el.value.slice(0, start) + text + el.value.slice(end);

    el.value = nextValue;
    const nextPos = start + text.length;
    el.setSelectionRange(nextPos, nextPos);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const runInputMenuAction = async (action: 'copy' | 'paste' | 'cut' | 'selectAll') => {
    const el = inputMenu.target;
    if (!el) return;

    try {
      el.focus();

      if (action === 'selectAll') {
        el.select();
        closeInputMenu();
        return;
      }

      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const selectedText = el.value.slice(start, end);
      const canEdit = !el.readOnly && !el.disabled;

      if (action === 'copy') {
        if (!selectedText) {
          closeInputMenu();
          return;
        }
        await writeText(selectedText);
        closeInputMenu();
        return;
      }

      if (action === 'cut') {
        if (!selectedText || !canEdit) {
          closeInputMenu();
          return;
        }
        await writeText(selectedText);
        replaceInputSelection(el, '');
        closeInputMenu();
        return;
      }

      if (action === 'paste') {
        if (!canEdit) {
          closeInputMenu();
          return;
        }
        const text = await readText();
        if (!text) {
          closeInputMenu();
          return;
        }
        replaceInputSelection(el, text);
        closeInputMenu();
        return;
      }
    } catch (e: any) {
      showToast(
        settings.lang === 'de'
          ? `Kontextmenü Aktion fehlgeschlagen: ${String(e)}`
          : `Context menu action failed: ${String(e)}`,
        true
      );
      closeInputMenu();
    }
  };

  const loadServers = async () => { try { setConnections(await invoke('get_connections')); } catch(e){} };
  useEffect(() => { loadServers(); }, []);

  const finalizeMainClose = async () => {
    if (mainClosingRef.current) return
    mainClosingRef.current = true
    const win = getCurrentWindow()
    await win.close()
  }

  const requestEditorClose = (force: boolean) => {
    const currentEditors = editorWindowsRef.current

    if (currentEditors.length === 0) {
      void finalizeMainClose()
      return
    }

    mainWaitingForEditorsRef.current = true
    channelRef.current?.postMessage({
      type: "main-request-close-editors",
      force
    })
  }

  const continueMainCloseFlow = async () => {
    if (mainCloseDialogBusyRef.current) return

    const currentEditors = editorWindowsRef.current

    if (currentEditors.length === 0) {
      await finalizeMainClose()
      return
    }

    const dirtyEditors = currentEditors.filter((item) => item.dirty)

    if (dirtyEditors.length > 0) {
      mainWaitingForEditorsRef.current = false
      setMainCloseDialogOpen(true)
      return
    }

    requestEditorClose(false)
  }

  useEffect(() => {
    const channel = new BroadcastChannel("termina-editor-sync")
    channelRef.current = channel

    channel.onmessage = (event) => {
      const msg = event.data || {}

      if (msg.type === "editor-state" && msg.label) {
        setEditorWindows((prev) => {
          const nextItem: EditorWindowInfo = {
            label: String(msg.label),
            fileName: String(msg.fileName || ""),
            remotePath: String(msg.remotePath || ""),
            dirty: Boolean(msg.dirty)
          }

          const filtered = prev.filter((item) => item.label !== nextItem.label)
          return [...filtered, nextItem]
        })
        return
      }

      if (msg.type === "editor-closed" && msg.label) {
        setEditorWindows((prev) => {
          const next = prev.filter((item) => item.label !== msg.label)

          if (mainWaitingForEditorsRef.current && next.length === 0) {
            window.setTimeout(() => {
              void finalizeMainClose()
            }, 0)
          }

          return next
        })
      }
    }

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined

    win.onCloseRequested(async (event) => {
      if (mainClosingRef.current) return

      event.preventDefault()

      if (mainCloseDialogBusyRef.current) return

      if (settingsRef.current?.closeToTray) {
        await win.hide()
        return
      }

      const currentTabs = openTabsRef.current

      if (currentTabs.length > 0) {
        setSessionCloseDialogOpen(true)
        return
      }

      await continueMainCloseFlow()
    }).then((fn) => {
      unlisten = fn
    }).catch(console.error)

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    let unlistenTrayQuit: (() => void) | undefined

    listen("tray-quit-requested", async () => {
      if (mainClosingRef.current) return
      if (mainCloseDialogBusyRef.current) return

      const currentTabs = openTabsRef.current

      if (currentTabs.length > 0) {
        setSessionCloseDialogOpen(true)
        return
      }

      await continueMainCloseFlow()
    }).then((fn) => {
      unlistenTrayQuit = fn
    }).catch(console.error)

    return () => {
      if (unlistenTrayQuit) unlistenTrayQuit()
    }
  }, [])

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

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;

      const target = e.target as Element | null;
      const field = target?.closest('input, textarea') ?? null;

      if (isTextField(field)) {
        e.preventDefault();
        e.stopPropagation();

        field.focus();

        const menuWidth = 176;
        const menuHeight = 172;
        const nextX = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
        const nextY = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

        setInputMenu({
          open: true,
          x: Math.max(8, nextX),
          y: Math.max(8, nextY),
          target: field
        });
        return;
      }

      e.preventDefault();
      closeInputMenu();
    };

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-input-context-menu="true"]')) return;
      closeInputMenu();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeInputMenu();
    };

    const handleWindowChange = () => closeInputMenu();

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
    };
  }, [settings.lang, inputMenu.target]);

  const openTerminal = (server: any) => {
    const findExistingTabId = () => {
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

    const existingTabId = findExistingTabId();
    if (existingTabId) {
      setActiveTabId(existingTabId);
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

  const closeTab = (tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.tabId !== tabId);
      if (activeTabId === tabId) setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].tabId : null);
      return newTabs;
    });
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

    

  const dirtyEditors = editorWindows.filter((item) => item.dirty)

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
                      onClick={() => openTerminal(localItem ? { id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' } : conn)}
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
                      onClick={() => openTerminal({ id: 'local', isLocal: true, name: 'Local Terminal', username: 'local', host: 'localhost' })}
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
                        onClick={() => openTerminal(conn)}
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
                                  onClick={() => openTerminal(conn)}
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
                recentConns={connections.slice(0, 5)}
                activateTab={(tabId: string) => setActiveTabId(tabId)}
              />
           </div>
           {openTabs.map(tab => (
              <div key={tab.tabId} className={`absolute inset-0 ${activeTabId === tab.tabId ? 'block' : 'hidden'}`}>
                 <TerminalPane server={tab} sessionId={tab.sessionId} settings={settings} showToast={showToast} onCloseTab={() => closeTab(tab.tabId)} isActive={activeTabId === tab.tabId} showDialog={showDialog} />
              </div>
           ))}
        </div>
      </div>

      <ConnectionModal isOpen={isConnModalOpen} onClose={() => setConnModalOpen(false)} serverToEdit={serverToEdit} onSuccess={loadServers} showToast={showToast} showDialog={showDialog} lang={settings.lang} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} setSettings={setSettings} showToast={showToast} showDialog={showDialog} />

      {sessionCloseDialogOpen && (
        <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl">
            <div className="px-4 py-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
              <div className="text-[14px] leading-[1.2] font-bold text-[var(--text-main)]">
                {t("activeTerminalSessionsTitle", settings.lang)}
              </div>
              <div className="text-[12px] leading-[1.4] text-[var(--text-muted)] mt-1">
                {t("activeTerminalSessionsText", settings.lang)}
              </div>
            </div>

            <div className="px-4 py-3 max-h-72 overflow-auto">
              <div className="flex flex-col gap-3">
                {openTabs.map((tab) => (
                  <div key={tab.tabId} className="rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_84%,var(--bg-app))] px-3 py-2.5">
                    <div className="text-sm font-medium text-[var(--text-main)] break-words">
                      {tab.name || tab.host || tab.tabId}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] break-words mt-1">
                      {tab.isLocal ? t("localTerminalShort", settings.lang) : `${tab.username || ""}@${tab.host || ""}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] flex items-center justify-end gap-2 bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))]">
              <button
                onClick={() => setSessionCloseDialogOpen(false)}
                className="min-h-9 px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] text-[var(--text-main)] text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
              >
                {t("cancel", settings.lang)}
              </button>

              <button
                onClick={async () => {
                  setSessionCloseDialogOpen(false)
                  await continueMainCloseFlow()
                }}
                className="min-h-9 px-4 py-2 rounded-xl border border-yellow-500 bg-yellow-500 text-black text-[13px] font-medium transition-opacity hover:opacity-90"
              >
                {t("closeAnyway", settings.lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {mainCloseDialogOpen && (
        <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl">
            <div className="px-4 py-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))]">
              <div className="text-[14px] leading-[1.2] font-bold text-[var(--text-main)]">
                {t("unsavedEditorChangesTitle", settings.lang)}
              </div>
              <div className="text-[12px] leading-[1.4] text-[var(--text-muted)] mt-1">
                {t("unsavedEditorChangesText", settings.lang)}
              </div>
            </div>

            <div className="px-4 py-3 max-h-72 overflow-auto">
              <div className="flex flex-col gap-3">
                {dirtyEditors.map((item) => (
                  <div key={item.label} className="rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-sidebar)_84%,var(--bg-app))] px-3 py-2.5">
                    <div className="text-sm font-medium text-[var(--text-main)] break-words">
                      {item.fileName || item.label}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] break-words mt-1">
                      {item.remotePath || item.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] flex items-center justify-end gap-2 bg-[color-mix(in_srgb,var(--bg-app)_88%,var(--bg-sidebar))]">
              <button
                onClick={() => {
                  mainWaitingForEditorsRef.current = false
                  setMainCloseDialogBusy(false)
                  setMainCloseDialogOpen(false)
                }}
                className="min-h-9 px-4 py-2 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] text-[var(--text-main)] text-[13px] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
                disabled={mainCloseDialogBusy}
              >
                {t("cancel", settings.lang)}
              </button>

              <button
                onClick={() => {
                  setMainCloseDialogBusy(true)
                  setMainCloseDialogOpen(false)
                  requestEditorClose(true)
                }}
                className="min-h-9 px-4 py-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)] text-white text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
                disabled={mainCloseDialogBusy}
              >
                {t("closeAllAndDiscard", settings.lang)}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {inputMenu.open && (
        <div
          data-input-context-menu="true"
          className="fixed z-[320] w-[176px] rounded-xl border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-app)_92%,black)] shadow-2xl overflow-hidden"
          style={{ left: inputMenu.x, top: inputMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runInputMenuAction('copy')}
            className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {settings.lang === 'de' ? 'Kopieren' : 'Copy'}
          </button>

          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runInputMenuAction('paste')}
            className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {settings.lang === 'de' ? 'Einfügen' : 'Paste'}
          </button>

          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runInputMenuAction('cut')}
            className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {settings.lang === 'de' ? 'Ausschneiden' : 'Cut'}
          </button>

          <div className="h-px bg-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]" />

          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runInputMenuAction('selectAll')}
            className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {settings.lang === 'de' ? 'Alles auswählen' : 'Select all'}
          </button>
        </div>
      )}

      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2.5 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-auto ${
              t.isErr
                ? 'border-[color-mix(in_srgb,var(--danger)_58%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-app)_88%,black)]'
                : 'border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-app)_88%,black)]'
            }`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                t.isErr ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]'
              }`}
            />
            <span className="text-[13px] leading-[1.35] font-medium text-[var(--text-main)] max-w-sm break-words">
              {t.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
