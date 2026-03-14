import React from "react";
import { useMemo, useState } from "react";
import {
  Terminal,
  Zap,
  Clock,
  Server,
  ArrowRight,
  PlusCircle
} from "lucide-react";
import { t } from "../lib/i18n";

export default function Dashboard({ lang, settings, openTerminal, activeTabs, recentConns, activateTab }: any) {
  const [qc, setQc] = useState({ user: "root", host: "", port: 22 });

  const activeCount = activeTabs?.length || 0;
  const recentCount = recentConns?.length || 0;

  const recentItems = useMemo(() => (recentConns || []).slice(0, 6), [recentConns]);

  const showQuickConnect = settings?.showDashboardQuickConnect !== false;
  const showWorkflow = settings?.showDashboardWorkflow !== false;
  const showActiveSessionsCard = settings?.showDashboardActiveSessions !== false;
  const showRecentConnectionsCard = settings?.showDashboardRecentConnections !== false;
  const hasBottomCards = showActiveSessionsCard || showRecentConnectionsCard;
  const bottomGridClass = showActiveSessionsCard && showRecentConnectionsCard
    ? "grid grid-cols-1 xl:grid-cols-2 gap-6"
    : "grid grid-cols-1 gap-6";

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
      <div className="w-full max-w-5xl mx-auto px-6 py-6 flex flex-col gap-6">
        {showWorkflow && (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] shadow-xl overflow-hidden">
            <div className="p-6 md:p-7 flex flex-col gap-6">
              <div className="space-y-3">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[var(--text-main)]">
                  Focused SSH workflow
                </h1>
                <p className="text-sm text-[var(--text-muted)] max-w-2xl leading-relaxed">
                  {t("dashboardDesc", lang)}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  onClick={() =>
                    openTerminal({
                      id: "local",
                      isLocal: true,
                      name: "Local Terminal",
                      username: "local",
                      host: "localhost"
                    })
                  }
                  className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] hover:bg-[var(--bg-hover)] transition-all p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                      <Terminal size={18} className="text-[var(--accent)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[var(--text-main)]">
                        Local Terminal
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        localhost
                      </div>
                    </div>
                  </div>
                </button>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                      <Terminal size={18} className="text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] font-bold">
                        {t("activeSessions", lang)}
                      </div>
                      <div className="text-xl font-bold text-[var(--text-main)]">
                        {activeCount}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                      <Clock size={18} className="text-[var(--accent)]" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)] font-bold">
                        {t("recent", lang)}
                      </div>
                      <div className="text-2xl font-bold text-[var(--text-main)]">
                        {recentCount}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showQuickConnect && (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] shadow-lg">
            <div className="p-5 md:p-6 flex items-center gap-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                <Zap className="text-[var(--accent)]" size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold">{t("quickConnect", lang)}</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  SSH in one step
                </p>
              </div>
            </div>

            <form onSubmit={handleQuickConnect} className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-[110px_1fr_88px_auto] gap-3 items-center">
              <input
                type="text"
                placeholder={t("username", lang)}
                value={qc.user}
                onChange={(e) => setQc({ ...qc, user: e.target.value })}
                className="h-10 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3.5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
              />

              <input
                type="text"
                placeholder="192.168.1.10 or server.example.com"
                value={qc.host}
                onChange={(e) => setQc({ ...qc, host: e.target.value })}
                className="h-11 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-4 outline-none focus:border-[var(--accent)]"
                autoFocus
              />

              <input
                type="number"
                placeholder="22"
                value={qc.port}
                onChange={(e) => setQc({ ...qc, port: parseInt(e.target.value || "22", 10) })}
                className="h-11 bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-4 outline-none focus:border-[var(--accent)]"
              />

              <button
                type="submit"
                className="h-10 bg-[var(--accent)] text-black font-bold px-4 rounded-xl hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
              >
                {t("connect", lang)}
                <ArrowRight size={16} />
              </button>
            </form>
          </div>
        )}

        {hasBottomCards && (
          <div className={bottomGridClass}>
            {showActiveSessionsCard && (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] shadow-lg overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                    <Terminal size={18} className="text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-main)]">
                      {t("activeSessions", lang)}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Currently open terminals
                    </div>
                  </div>
                </div>

                <div className="p-4 flex flex-col gap-2.5">
                  {activeCount === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)] p-5 text-center">
                      <div className="flex justify-center mb-2.5">
                        <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                          <PlusCircle size={18} className="text-[var(--text-muted)]" />
                        </div>
                      </div>
                      <div className="text-[13px] font-semibold text-[var(--text-main)]">
                        {t("noActiveSessions", lang)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1">
                        {t("noActiveSessionsHint", lang)}
                      </div>
                    </div>
                  ) : (
                    activeTabs.map((tab: any) => (
                      <button
                        key={tab.tabId}
                        onClick={() => activateTab?.(tab.tabId)}
                        className="w-full flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3.5 py-2.5 text-left hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-sidebar)]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0"></span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[var(--text-main)] truncate">
                              {tab.name}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] truncate">
                              {tab.isLocal ? "Local Terminal" : `${tab.username || ""}@${tab.host || ""}`}
                            </div>
                          </div>
                        </div>

                        <ArrowRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {showRecentConnectionsCard && (
              <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] shadow-xl overflow-hidden">
                <div className="px-6 py-5 flex items-center gap-3 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-subtle)]">
                    <Clock size={18} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--text-main)]">
                      {t("recent", lang)}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Quick access to recent hosts
                    </div>
                  </div>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  {recentItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-app)] p-6 text-center">
                      <div className="flex justify-center mb-3">
                        <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
                          <Server size={18} className="text-[var(--text-muted)]" />
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-[var(--text-main)]">
                        {t("noRecentConnections", lang)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1">
                        {t("noRecentConnectionsHint", lang)}
                      </div>
                    </div>
                  ) : (
                    recentItems.map((c: any, i: number) => (
                      <button
                        key={i}
                        onClick={() => openTerminal(c)}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] transition-all text-left group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] shrink-0">
                            <Server size={15} className="text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[var(--text-main)] truncate">
                              {c.name}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] truncate">
                              {c.username ? `${c.username}@${c.host || ""}` : c.host || ""}
                            </div>
                          </div>
                        </div>

                        <ArrowRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
