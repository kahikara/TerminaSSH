import React from "react";
import { useMemo, useState } from "react";
import {
  Terminal,
  Zap,
  Clock,
  Server,
  ArrowRight,
  PlusCircle,
  Activity
} from "lucide-react";
import { t } from "../lib/i18n";

export default function Dashboard({ lang, openTerminal, activeTabs, recentConns, activateTab }: any) {
  const [qc, setQc] = useState({ user: "", host: "", port: 22 });

  const activeCount = activeTabs?.length || 0;
  const recentCount = recentConns?.length || 0;
  const recentItems = useMemo(() => (recentConns || []).slice(0, 6), [recentConns]);

  const ui = lang === "de"
    ? {
        heroTitle: "Start",
        heroText:
          "Öffne eine lokale Sitzung oder springe direkt in eine Verbindung.",
        localTitle: "Lokale Sitzung",
        localHint: "Shell direkt auf diesem System öffnen",
        activeLabel: "Aktiv",
        recentLabel: "Zuletzt genutzt",
        quickTitle: "Quick Connect",
        quickText: "Temporäre Verbindung ohne gespeicherten Servereintrag.",
        hostLabel: "Host",
        userLabel: "User",
        portLabel: "Port",
        hostPlaceholder: "192.168.1.10 oder server.example.com",
        connectNow: "Verbinden",
        activeTitle: "Aktive Sitzungen",
        activeText: "Alle aktuell geöffneten lokalen und entfernten Terminals",
        recentTitle: "Letzte Verbindungen",
        recentText: "Schneller Zugriff auf zuletzt genutzte Server",
        noRecentTitle: t("noRecentConnections", lang),
        noRecentText: t("noRecentConnectionsHint", lang),
        noActiveTitle: t("noActiveSessions", lang),
        noActiveText: t("noActiveSessionsHint", lang),
        localSession: "Lokale Sitzung"
      }
    : {
        heroTitle: "Start",
        heroText:
          "Open a local session or jump straight into a connection.",
        localTitle: "Local Session",
        localHint: "Open a shell directly on this system",
        activeLabel: "Active",
        recentLabel: "Recent",
        quickTitle: "Quick Connect",
        quickText: "Temporary connection without saving a server entry first.",
        hostLabel: "Host",
        userLabel: "User",
        portLabel: "Port",
        hostPlaceholder: "192.168.1.10 or server.example.com",
        connectNow: "Connect",
        activeTitle: "Active Sessions",
        activeText: "All currently open local and remote terminals",
        recentTitle: "Recent Connections",
        recentText: "Quick access to recently used servers",
        noRecentTitle: t("noRecentConnections", lang),
        noRecentText: t("noRecentConnectionsHint", lang),
        noActiveTitle: t("noActiveSessions", lang),
        noActiveText: t("noActiveSessionsHint", lang),
        localSession: "Local Session"
      };

  const handleQuickConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qc.host) return;

    openTerminal({
      id: "qc_" + Date.now(),
      isQuickConnect: true,
      quickConnectNeedsPassword: true,
      name: qc.host,
      username: qc.user,
      host: qc.host,
      port: qc.port
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-app)] text-[var(--text-main)] min-h-0">
      <div className="w-full max-w-5xl mx-auto px-6 py-6 flex flex-col gap-5">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))] shadow-lg overflow-hidden">
          <div className="p-5 md:p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] border border-[var(--border-subtle)] shrink-0">
                <Terminal size={17} className="text-[var(--accent)]" />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[var(--text-main)]">
                  {ui.heroTitle}
                </div>
                <div className="text-[12px] text-[var(--text-muted)]">
                  {ui.heroText}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                onClick={() =>
                  openTerminal({
                    id: "local",
                    isLocal: true,
                    name: "Local Session",
                    username: "local",
                    host: "localhost"
                  })
                }
                className="group rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] hover:bg-[var(--bg-hover)] transition-all px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] shrink-0">
                    <Terminal size={17} className="text-[var(--accent)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[var(--text-main)]">
                      {ui.localTitle}
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)]">
                      {ui.localHint}
                    </div>
                  </div>
                </div>
              </button>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] shrink-0">
                    <Activity size={17} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-bold">
                      {ui.activeLabel}
                    </div>
                    <div className="text-[22px] leading-none mt-1 font-bold text-[var(--text-main)]">
                      {activeCount}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] shrink-0">
                    <Clock size={17} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-bold">
                      {ui.recentLabel}
                    </div>
                    <div className="text-[22px] leading-none mt-1 font-bold text-[var(--text-main)]">
                      {recentCount}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))] shadow-lg overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] border border-[var(--border-subtle)] shrink-0">
              <Zap className="text-[var(--accent)]" size={17} />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[var(--text-main)]">{ui.quickTitle}</h2>
              <p className="text-[12px] text-[var(--text-muted)] leading-[1.4]">
                {ui.quickText}
              </p>
            </div>
          </div>

          <form onSubmit={handleQuickConnect} className="p-5 grid grid-cols-1 lg:grid-cols-[120px_1fr_96px_auto] gap-3 items-end">
            <label className="block">
              <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
                {ui.userLabel}
              </span>
              <input
                type="text"
                placeholder={t("username", lang)}
                value={qc.user}
                onChange={(e) => setQc({ ...qc, user: e.target.value })}
                className="w-full h-10 bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[color-mix(in_srgb,var(--accent)_24%,var(--border-subtle))] rounded-xl px-4 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[13px]"
              />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
                {ui.hostLabel}
              </span>
              <input
                type="text"
                placeholder={ui.hostPlaceholder}
                value={qc.host}
                onChange={(e) => setQc({ ...qc, host: e.target.value })}
                className="w-full h-10 bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[color-mix(in_srgb,var(--accent)_24%,var(--border-subtle))] rounded-xl px-4 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[13px]"
                autoFocus
              />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
                {ui.portLabel}
              </span>
              <input
                type="number"
                placeholder="22"
                value={qc.port}
                onChange={(e) => setQc({ ...qc, port: parseInt(e.target.value || "22", 10) })}
                className="w-full h-10 bg-[color-mix(in_srgb,var(--bg-app)_78%,var(--bg-sidebar))] border border-[color-mix(in_srgb,var(--accent)_24%,var(--border-subtle))] rounded-xl px-4 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[13px]"
              />
            </label>

            <button
              type="submit"
              className="h-10 min-w-[120px] bg-[var(--accent)] text-black font-bold px-4 rounded-xl hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
            >
              {ui.connectNow}
              <ArrowRight size={15} />
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))] shadow-lg overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] border border-[var(--border-subtle)] shrink-0">
                <Terminal size={17} className="text-[var(--accent)]" />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[var(--text-main)]">
                  {ui.activeTitle}
                </div>
                <div className="text-[12px] text-[var(--text-muted)]">
                  {ui.activeText}
                </div>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-2">
              {activeCount === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] p-5 text-center">
                  <div className="flex justify-center mb-2.5">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                      <PlusCircle size={17} className="text-[var(--text-muted)]" />
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold text-[var(--text-main)]">
                    {ui.noActiveTitle}
                  </div>
                  <div className="text-[12px] text-[var(--text-muted)] mt-1 leading-[1.45]">
                    {ui.noActiveText}
                  </div>
                </div>
              ) : (
                activeTabs.map((tab: any) => (
                  <button
                    key={tab.tabId}
                    onClick={() => activateTab?.(tab.tabId)}
                    className="w-full flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-3.5 py-2.5 text-left hover:border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))] hover:bg-[var(--bg-hover)] transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] shrink-0"></span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[var(--text-main)] truncate">
                          {tab.name}
                        </div>
                        <div className="text-[12px] text-[var(--text-muted)] truncate">
                          {tab.isLocal ? ui.localSession : `${tab.username || ""}@${tab.host || ""}`}
                        </div>
                      </div>
                    </div>

                    <ArrowRight size={15} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-sidebar)_92%,var(--bg-app))] shadow-lg overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] border border-[var(--border-subtle)] shrink-0">
                <Clock size={17} className="text-[var(--accent)]" />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[var(--text-main)]">
                  {ui.recentTitle}
                </div>
                <div className="text-[12px] text-[var(--text-muted)]">
                  {ui.recentText}
                </div>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-2">
              {recentItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] p-5 text-center">
                  <div className="flex justify-center mb-2.5">
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                      <Server size={17} className="text-[var(--text-muted)]" />
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold text-[var(--text-main)]">
                    {ui.noRecentTitle}
                  </div>
                  <div className="text-[12px] text-[var(--text-muted)] mt-1 leading-[1.45]">
                    {ui.noRecentText}
                  </div>
                </div>
              ) : (
                recentItems.map((c: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => openTerminal(c)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_82%,var(--bg-sidebar))] px-3.5 py-2.5 hover:border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))] hover:bg-[var(--bg-hover)] transition-all text-left group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] shrink-0">
                        <Server size={14} className="text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[var(--text-main)] truncate">
                          {c.name}
                        </div>
                        <div className="text-[12px] text-[var(--text-muted)] truncate">
                          {c.username ? `${c.username}@${c.host || ""}` : c.host || ""}
                        </div>
                      </div>
                    </div>

                    <ArrowRight size={15} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
