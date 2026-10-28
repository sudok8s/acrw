import { useEffect, useMemo, useRef } from "react";
import { Icon, RavenMark, type IconName } from "./icons";
import { useStore, type Screen } from "./store";
import { REVIEW_STATUSES, isUnresolved } from "./types";
import { isTauri } from "./api";
import { CommandPalette } from "./CommandPalette";
import { ReviewScreen } from "./screens/Review";
import { FindingsScreen } from "./screens/Findings";
import { ScansScreen } from "./screens/Scans";
import { FlowScreen } from "./screens/Flow";
import { OverviewScreen } from "./screens/Overview";
import { ProjectsScreen } from "./screens/Projects";
import { SettingsScreen } from "./screens/Settings";
import { CompareControl } from "./screens/Compare";

const TITLES: Record<Screen, string> = {
  overview: "Overview", projects: "Projects", review: "Review workspace", flow: "Source → sink explorer",
  findings: "Findings", scans: "Scans", settings: "Settings",
};

export function App() {
  const s = useStore();
  const compact = s.settings?.sidebar_compact ?? false;
  const active = s.scans.filter((x) => x.status === "running" || x.status === "queued");
  const unresolved = s.findings.filter((f) => isUnresolved(f.status)).length;

  const nav: { id: Screen; label: string; icon: IconName; count?: string }[] = [
    { id: "overview", label: "Overview", icon: "overview" },
    { id: "projects", label: "Projects", icon: "projects" },
    { id: "review", label: "Review Workspace", icon: "review" },
    { id: "findings", label: "Findings", icon: "findings", count: unresolved ? String(unresolved) : "" },
    { id: "scans", label: "Scans", icon: "scans", count: active.length ? String(active.length) : "" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  // Keyboard: ⌘K / Ctrl+K palette; J/K signals, [ ] files, R reviewed (review screen only).
  const ref = useRef(s);
  ref.current = s;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = ref.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); st.setPaletteOpen(!st.paletteOpen); return; }
      if (e.key === "Escape" && st.paletteOpen) { st.setPaletteOpen(false); return; }
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.closest(".monaco-editor") || e.metaKey || e.ctrlKey || e.altKey || st.paletteOpen) return;
      if (st.screen !== "review") return;
      if (["j", "k", "[", "]", "r"].includes(e.key)) window.dispatchEvent(new CustomEvent("acrw:key", { detail: e.key }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const density = s.settings?.density === "comfortable" ? "comfy" : "";
  const aiOn = s.settings?.ai_enabled;
  const reviewCtx = (s.screen === "review" || s.screen === "flow") && s.review;

  const screen = useMemo(() => {
    switch (s.screen) {
      case "review": return <ReviewScreen />;
      case "findings": return <FindingsScreen />;
      case "scans": return <ScansScreen />;
      case "flow": return <FlowScreen />;
      case "overview": return <OverviewScreen />;
      case "projects": return <ProjectsScreen />;
      case "settings": return <SettingsScreen />;
    }
  }, [s.screen]);

  return (
    <div className="outer">
      <div className={`app ${density}`}>
        <aside className={"cw-sidebar" + (compact ? " cw-sidebar-compact" : "")} aria-label="Primary navigation">
          <div className="cw-brand">
            <button className="brand-btn" onClick={() => s.go("review")} aria-label="ACRW — open review workspace">
              <RavenMark size={26} />
              {!compact && <span><span className="cw-brand-name" style={{ display: "block" }}>ACRW</span><span className="cw-brand-sub" style={{ display: "block" }}>A Crow Review Workbench</span></span>}
            </button>
          </div>
          <nav className="nav-group" aria-label="Sections">
            {nav.map((n) => (
              <div key={n.id} style={{ display: "contents" }}>
                <button className="cw-nav-item" aria-current={s.screen === n.id ? "page" : undefined} onClick={() => s.go(n.id)} title={n.label}>
                  <Icon name={n.icon} />
                  {!compact && <><span>{n.label}</span><span className="cw-nav-count">{n.count}</span></>}
                </button>
                {n.id === "review" && (
                  <button className="cw-nav-item cw-nav-sub" aria-current={s.screen === "flow" ? "page" : undefined} onClick={() => s.openFlow(s.flowFindingId)} title="Source → sink explorer">
                    {compact ? <Icon name="flow" /> : <span>Source → sink</span>}
                  </button>
                )}
              </div>
            ))}
          </nav>
          <div className="cw-sidebar-ctx">
            {!compact && s.project && (
              <>
                <span className="label">Project</span>
                <span className="ctx-proj" title={s.project.path}><Icon name="repo" size={12} />{s.project.name}</span>
                {s.review && <span className="ctx-proj muted" title={s.review.target}><Icon name="branch" size={12} />{s.review.target}</span>}
              </>
            )}
            <button className="cw-iconbtn cw-iconbtn-sm sb-toggle" onClick={() => s.updateSettings({ sidebar_compact: !compact })} aria-label={compact ? "Expand sidebar" : "Compact sidebar"} title={compact ? "Expand sidebar" : "Compact sidebar"}>
              <Icon name="sidebar" />
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="cw-ctxbar">
            <span className="cw-crumbs"><b>{s.project?.name ?? "ACRW"}</b><span className="cw-sep">/</span><span>{TITLES[s.screen]}</span></span>
            {reviewCtx && s.review && (
              <>
                <span className="cw-rev" title={s.project?.path}><Icon name="repo" />{s.project?.path.split(/[\\/]/).slice(-2).join("/")}</span>
                <CompareControl />
                <label className="row" style={{ gap: 6 }}>
                  <span className="caption">Review</span>
                  <select className="input status-select" value={s.review.status} onChange={(e) => s.setReviewStatus(e.target.value)} aria-label="Review status">
                    {REVIEW_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              </>
            )}
            <span className="cw-ctx-spacer" />
            {active.length > 0 && (
              <button className="task-chip" onClick={() => s.showScan(active[0].id)} title="Background scans">
                <Icon name="spinner" size={12} spin />
                {active.length === 1 ? `${active[0].scanner} running` : `${active.length} scans running`}
              </button>
            )}
            <button className="cw-cmd" onClick={() => s.setPaletteOpen(true)} aria-label="Open command palette">
              <Icon name="search" /><span className="cw-cmd-text">Search or jump to…</span><kbd className="cw-kbd">{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
            </button>
          </header>

          <main className="ws">{screen}</main>

          <footer className="cw-statusbar">
            <span className="cw-statusbar-item"><RavenMark size={12} mono />{isTauri ? "Local" : "Browser demo"}</span>
            {s.review && <span className="cw-statusbar-item"><Icon name="branch" />{s.review.target}</span>}
            {active.map((r) => (
              <button key={r.id} className="cw-statusbar-item" onClick={() => s.showScan(r.id)} title="Open in Scans">
                <Icon name="spinner" spin style={{ color: "#82A8D8" }} />{r.scanner} #{r.id} · {r.status}
              </button>
            ))}
            {active.length === 0 && <button className="cw-statusbar-item" onClick={() => s.go("scans")}><Icon name="check" />No scans running</button>}
            <span className="spacer" />
            <button className={"cw-provider " + (aiOn ? (s.settings?.ai_provider === "local" ? "cw-provider-local" : "cw-provider-external") : "cw-provider-off")} onClick={() => s.go("settings")} title="AI provider settings">
              <span className="cw-provider-dot" />{aiOn ? (s.settings?.ai_provider === "local" ? "Local model" : "External") : "AI off"}
            </button>
            <span className="cw-statusbar-item">v{s.info?.version ?? "…"}</span>
          </footer>
        </div>

        {s.paletteOpen && <CommandPalette />}
        {s.toast && <div className="toast" role="status"><Icon name="info" /><span>{s.toast}</span></div>}
      </div>
    </div>
  );
}
