import { useState, type ReactNode } from "react";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import { useStore } from "../store";
import type { Settings } from "../types";
import { Banner, Seg, Switch } from "../ui";

type Sec = "scanners" | "review" | "ai" | "storage" | "appearance";
const SECTIONS: [Sec, string, IconName, string][] = [
  ["scanners", "Scanners", "scans", "Binaries and rule sets used by Start scan and Scan target."],
  ["review", "Review preferences", "review", "How the Review workspace shows diffs and signals."],
  ["ai", "AI provider and privacy", "lock", "Optional assistance. Off by default."],
  ["storage", "Local data", "folder", "Where ACRW keeps its database and temporary worktrees."],
  ["appearance", "Appearance and editor", "eye", "Density, code font size and sidebar."],
];

function Row({ label, desc, children }: { label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="col" style={{ gap: 0 }}><span className="set-label">{label}</span>{desc && <span className="caption">{desc}</span>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

export function SettingsScreen() {
  const s = useStore();
  const [sec, setSec] = useState<Sec>("scanners");
  const st = s.settings;
  if (!st) return <div className="loading-bar" />;
  const up = (p: Partial<Settings>) => s.updateSettings(p);
  const def = SECTIONS.find((x) => x[0] === sec)!;
  const ver = (n: string) => s.info?.scanners.find((x) => x.name === n)?.version;

  return (
    <div className="split">
      <nav className="set-nav" aria-label="Settings sections">
        <div className="label" style={{ padding: "4px 16px 8px" }}>Settings</div>
        {SECTIONS.map(([id, label, icon]) => (
          <button key={id} className="cw-nav-item" aria-current={sec === id ? "page" : undefined} onClick={() => setSec(id)}><Icon name={icon} /><span>{label}</span></button>
        ))}
      </nav>
      <div className="set-body">
        <div className="set-sec">
          <h1 className="page-title">{def[1]}</h1>
          <span className="caption" style={{ marginBottom: 8 }}>{def[3]} Changes save immediately.</span>

          {sec === "scanners" && (
            <>
              <div className="set-group row"><span className="label">Semgrep</span><span className="mono muted">{ver("Semgrep") ?? "not found"}</span></div>
              <Row label="Enabled" desc="Included in Scan target."><Switch label="Semgrep enabled" on={st.semgrep_enabled} onChange={(v) => up({ semgrep_enabled: v })} /></Row>
              <Row label="Binary" desc="Name on PATH or a full path."><input className="input mono" value={st.semgrep_bin} onChange={(e) => up({ semgrep_bin: e.target.value })} aria-label="Semgrep binary" /></Row>
              <Row label="Rule configs" desc={<>One per line. <span className="mono">bundled:acrw-python</span> is ACRW's taint rule set; registry packs such as <span className="mono">p/python</span> need network access.</>}>
                <textarea className="input mono" style={{ width: "100%", minHeight: 72 }} value={st.semgrep_configs.join("\n")} aria-label="Semgrep configs"
                  onChange={(e) => up({ semgrep_configs: e.target.value.split("\n").map((x) => x.trim()).filter((x, i, a) => x || i < a.length - 1) })} />
              </Row>
              <div className="set-group row"><span className="label">Trivy</span><span className="mono muted">{ver("Trivy") ?? "not found"}</span></div>
              <Row label="Enabled" desc="Included in Scan target."><Switch label="Trivy enabled" on={st.trivy_enabled} onChange={(v) => up({ trivy_enabled: v })} /></Row>
              <Row label="Binary"><input className="input mono" value={st.trivy_bin} onChange={(e) => up({ trivy_bin: e.target.value })} aria-label="Trivy binary" /></Row>
              <Row label="Minimum severity" desc="Lower severities are not reported.">
                <select className="input" value={st.trivy_min_severity} onChange={(e) => up({ trivy_min_severity: e.target.value })}>
                  {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((x) => <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()} and above</option>)}
                </select>
              </Row>
              <Row label="Vulnerability DB mirror" desc="Optional, for networks that block the default registry (passed as --db-repository).">
                <input className="input mono" placeholder="registry.example.internal/trivy-db:2" value={st.trivy_db_repository} onChange={(e) => up({ trivy_db_repository: e.target.value })} aria-label="Trivy DB repository" />
              </Row>
              <div className="set-group row"><span className="label">Gitleaks</span><span className="mono muted">{ver("Gitleaks") ?? "not found"}</span></div>
              <Row label="Enabled" desc="Included in Scan target (working tree profile)."><Switch label="Gitleaks enabled" on={st.gitleaks_enabled} onChange={(v) => up({ gitleaks_enabled: v })} /></Row>
              <Row label="Binary" desc="Reports are always produced with --redact."><input className="input mono" value={st.gitleaks_bin} onChange={(e) => up({ gitleaks_bin: e.target.value })} aria-label="Gitleaks binary" /></Row>
              <span className="caption" style={{ marginTop: 8 }}>Scanner versions are detected at start-up; restart ACRW after installing a scanner.</span>
            </>
          )}

          {sec === "review" && (
            <>
              <Row label="Default diff mode" desc="Applies now.">
                <Seg label="Default diff mode" value={st.default_diff_mode} onChange={(v) => up({ default_diff_mode: v })} options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Side-by-side" }]} />
              </Row>
              <Row label="Inline finding notes in diff" desc="A note under each flagged line."><Switch label="Inline finding notes" on={st.inline_findings} onChange={(v) => up({ inline_findings: v })} /></Row>
            </>
          )}

          {sec === "ai" && (
            <>
              <div style={{ margin: "8px 0" }}><Banner kind="info" icon="lock" title="Not part of this MVP.">These preferences are stored, but no assistant is wired in yet and nothing is ever sent. When it lands, every request will show the exact, redacted context before anything leaves this machine.</Banner></div>
              <Row label="AI assistance" desc="Master switch."><Switch label="AI assistance" on={st.ai_enabled} onChange={(v) => up({ ai_enabled: v })} /></Row>
              <Row label="Provider" desc="Local models run on this machine; external providers would receive the context you approve.">
                <Seg label="AI provider" value={st.ai_provider} onChange={(v) => up({ ai_provider: v })} options={[{ value: "local", label: "Local model" }, { value: "external", label: "External provider" }]} />
              </Row>
              <Row label="Endpoint"><input className="input mono" value={st.ai_endpoint} onChange={(e) => up({ ai_endpoint: e.target.value })} aria-label="AI endpoint" /></Row>
              <Row label="Redaction" desc="Mask secrets, tokens and e-mail addresses in any context."><Switch label="Redaction" on={st.ai_redaction} onChange={(v) => up({ ai_redaction: v })} /></Row>
              {st.ai_provider === "external" && !st.ai_redaction && <Banner kind="danger" title="Redaction is off.">An external provider would receive unmasked code.</Banner>}
            </>
          )}

          {sec === "storage" && (
            <>
              <Row label="Database" desc="Projects, reviews, findings, notes and settings."><span className="mono caption" style={{ overflowWrap: "anywhere" }}>{s.info?.db_path}</span></Row>
              <Row label="Work directory" desc="Temporary worktrees and scanner reports. Worktrees are removed after each scan."><span className="mono caption" style={{ overflowWrap: "anywhere" }}>{s.info?.work_root}</span></Row>
              <Row label="Keep scan reports" desc="Retention is recorded now; automatic clean-up is not implemented in this MVP.">
                <select className="input" value={st.keep_scan_artifacts_days} onChange={(e) => up({ keep_scan_artifacts_days: Number(e.target.value) })}>
                  {[7, 30, 90, 3650].map((d) => <option key={d} value={d}>{d === 3650 ? "Until deleted" : `${d} days`}</option>)}
                </select>
              </Row>
            </>
          )}

          {sec === "appearance" && (
            <>
              <Row label="Theme" desc="ACRW ships one theme."><span className="caption">Dark</span></Row>
              <Row label="Density" desc="Comfortable adds 4px to every row.">
                <Seg label="Density" value={st.density} onChange={(v) => up({ density: v })} options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} />
              </Row>
              <Row label="Code font size" desc="JetBrains Mono in the diff.">
                <Seg label="Code font size" value={String(st.code_font_size)} onChange={(v) => up({ code_font_size: Number(v) })} options={["12.5", "13", "14"].map((v) => ({ value: v, label: v }))} />
              </Row>
              <Row label="Compact sidebar" desc="Icons only."><Switch label="Compact sidebar" on={st.sidebar_compact} onChange={(v) => up({ sidebar_compact: v })} /></Row>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
