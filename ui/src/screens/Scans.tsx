import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { useStore } from "../store";
import { Banner, Empty, fmtDuration, fmtTime, ScanState } from "../ui";

export function ScansScreen() {
  const s = useStore();
  const [startOpen, setStartOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const runs = useMemo(() => s.scans.filter((r) => !s.review || r.project_id === s.review.project_id), [s.scans, s.review]);
  const sel = runs.find((r) => r.id === s.scanSelId) ?? runs[0] ?? null;
  useEffect(() => { if (s.startOpenNonce) setStartOpen(true); }, [s.startOpenNonce]);
  useEffect(() => setConfirmCancel(false), [sel?.id]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Scans</h1>
        <span className="caption">Scanners run as local processes in a temporary worktree. Reports stay on this machine.</span>
        <span className="spacer" />
        <button className="cw-btn cw-btn-primary" onClick={() => setStartOpen(!startOpen)} aria-expanded={startOpen} disabled={!s.review}><Icon name="play" />Start scan</button>
      </div>
      <div className="scan-strip">
        {(s.info?.scanners ?? []).map((c) => {
          const last = runs.find((r) => r.scanner === c.name);
          return (
            <div key={c.name} className="scan-cell">
              <div className="row"><span className="set-label">{c.name}</span><span className="mono muted">{c.version ?? "not found"}</span><span className="spacer" />{last ? <ScanState status={last.status} /> : <span className="caption">Idle</span>}</div>
              <span className="caption">{c.version ? (c.enabled ? "Enabled" : "Disabled in Settings") : "Not on PATH — install it or set its path in Settings › Scanners"}</span>
              <span className="caption">Last run {last ? fmtTime(last.started_at) : "never"}</span>
            </div>
          );
        })}
      </div>
      {startOpen && <StartForm onDone={() => setStartOpen(false)} />}
      <div className="split">
        <div className="tbl-box">
          {runs.length === 0 ? (
            <Empty title="No scans yet">Start a scan to run Semgrep, Trivy or Gitleaks on a revision of {s.project?.name ?? "your repository"}.</Empty>
          ) : (
            <table className="cw-table" style={{ minWidth: 1040 }}>
              <colgroup><col style={{ width: 56 }} /><col style={{ width: 150 }} /><col style={{ width: 240 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 136 }} /><col style={{ width: 80 }} /><col style={{ width: 100 }} /></colgroup>
              <thead><tr><th>Run</th><th>Scanner</th><th>Revision</th><th>Profile</th><th>Status</th><th>Started</th><th>Duration</th><th>Findings</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} aria-selected={r.id === sel?.id} onClick={() => s.showScan(r.id)}>
                    <td className="cw-path"><button className="row-link mono" style={{ fontWeight: 400 }} onClick={() => s.showScan(r.id)}>#{r.id}</button></td>
                    <td>{r.scanner} <span className="mono muted">{r.version ?? ""}</span></td>
                    <td className="cw-path" title={r.rev}>{r.rev}{r.commit ? `@${r.commit}` : ""}</td>
                    <td title={r.profile}>{r.profile}</td>
                    <td><ScanState status={r.status} /></td>
                    <td className="cw-num">{fmtTime(r.started_at)}</td>
                    <td className="cw-num">{fmtDuration(r.started_at, r.finished_at)}</td>
                    <td className="caption">{r.status === "completed" ? `${r.finding_count} · ${r.new_count} new` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {sel && (
          <aside className="side" aria-label="Run details">
            <div className="cw-panel-head"><span className="cw-panel-title">Execution details</span><span className="mono muted">#{sel.id}</span></div>
            <div className="side-body">
              <div className="sec">
                <div className="row"><span className="set-label">{sel.scanner}</span><span className="mono muted">{sel.version ?? ""}</span><span className="spacer" /><ScanState status={sel.status} /></div>
                {(sel.status === "running" || sel.status === "queued") && <div className="loading-bar" />}
                {sel.status === "failed" && <Banner kind="danger" title="Scan failed.">{sel.error ?? "See the log."}</Banner>}
                <dl className="dlist">
                  <dt>Revision</dt><dd className="mono">{sel.rev}{sel.commit ? `@${sel.commit}` : ""}</dd>
                  <dt>Profile</dt><dd>{sel.profile}</dd>
                  <dt>Started</dt><dd>{fmtTime(sel.started_at)}</dd>
                  <dt>Duration</dt><dd className="cw-num">{fmtDuration(sel.started_at, sel.finished_at)}</dd>
                  <dt>Exit code</dt><dd className="mono">{sel.exit_code ?? "—"}</dd>
                  <dt>Findings</dt><dd>{sel.status === "completed" ? `${sel.finding_count} (${sel.new_count} new)` : "—"}</dd>
                </dl>
              </div>
              <div className="sec">
                <span className="label">Command</span>
                <div className="logbox" style={{ color: "#E6E6E8" }}>{sel.command || "—"}</div>
                <span className="label">Log</span>
                <div className="logbox">{sel.log.trim().split("\n").filter(Boolean).map((l, i) => <div key={i} className={/^ERR/.test(l) ? "lg-err" : ""}>{l}</div>)}</div>
              </div>
              <div className="sec">
                <div className="row wrap">
                  {sel.status === "completed" && <button className="cw-btn cw-btn-primary" onClick={() => s.showFindings({ scanner: sel.scanner, scope: "all", status: "all", selId: null })}><Icon name="findings" />View results</button>}
                  {(sel.status === "running" || sel.status === "queued") && <button className="cw-btn cw-btn-danger" onClick={() => setConfirmCancel(true)}><Icon name="stop" />Cancel scan</button>}
                  {(sel.status === "failed" || sel.status === "cancelled") && <button className="cw-btn" onClick={() => s.startScan(sel.scanner, sel.rev, sel.profile)}><Icon name="retry" />Run again</button>}
                </div>
                {confirmCancel && (
                  <Banner kind="danger" actions={<><button className="cw-btn cw-btn-sm cw-btn-primary" onClick={() => { s.cancelScan(sel.id); setConfirmCancel(false); }}>Cancel scan</button><button className="cw-btn cw-btn-sm" onClick={() => setConfirmCancel(false)}>Keep running</button></>}>
                    Cancel {sel.scanner} run #{sel.id}? Partial results are discarded.
                  </Banner>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function StartForm({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const scanners = s.info?.scanners ?? [];
  const [scanner, setScanner] = useState(scanners[0]?.name ?? "Semgrep");
  const info = scanners.find((x) => x.name === scanner);
  const [profile, setProfile] = useState(info?.profiles[0] ?? "");
  const [rev, setRev] = useState(s.review?.target ?? "");
  const [branches, setBranches] = useState<string[]>([]);
  useEffect(() => { setProfile(scanners.find((x) => x.name === scanner)?.profiles[0] ?? ""); }, [scanner]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.review) s.api.listBranches(s.review.project_id).then((b) => setBranches(b.branches)).catch(() => {}); }, [s.review, s.api]);
  if (!s.review) return null;
  const go = async () => { const r = await s.startScan(scanner, rev, profile); if (r) onDone(); };
  return (
    <div className="form-panel" role="group" aria-label="Start scan">
      <span className="cw-panel-title">New scan</span>
      <div className="form-grid">
        <label className="fld"><span className="caption">Scanner</span>
          <select className="input" value={scanner} onChange={(e) => setScanner(e.target.value)}>{scanners.map((x) => <option key={x.name} value={x.name}>{x.name}{x.version ? "" : " (not found)"}</option>)}</select></label>
        <label className="fld"><span className="caption">Profile</span>
          <select className="input" value={profile} onChange={(e) => setProfile(e.target.value)}>{(info?.profiles ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="fld"><span className="caption">Repository</span><input className="input" value={s.project?.name ?? ""} readOnly /></label>
        <label className="fld"><span className="caption">Revision</span>
          <select className="input" value={rev} onChange={(e) => setRev(e.target.value)}>{[...new Set([s.review.target, s.review.base, ...branches])].map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
      </div>
      {info && !info.version && <Banner kind="warning" title={`${scanner} was not found.`}>Install it or set its path in Settings › Scanners. The run will fail otherwise.</Banner>}
      {profile.startsWith("Git history") && <span className="caption">Scans commits in {s.review.base}...{rev} instead of the files at the revision.</span>}
      <div className="row"><span className="spacer" /><button className="cw-btn" onClick={onDone}>Cancel</button><button className="cw-btn cw-btn-primary" onClick={go} disabled={!rev}><Icon name="play" />Start scan</button></div>
    </div>
  );
}
