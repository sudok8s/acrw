import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { useStore } from "../store";
import { FINDING_STATUSES, isUnresolved, SEV_RANK, type Finding, type Note, type Severity } from "../types";
import { Empty, fmtTime, IconBtn, Provenance, SearchField, Seg, SevBadge, StatusTag } from "../ui";

type SortKey = "severity" | "title" | "scanner" | "file" | "line" | "status";
const COLS: [SortKey, string, string][] = [
  ["severity", "Severity", "128px"], ["title", "Finding", ""], ["scanner", "Scanner", "104px"],
  ["file", "File", "24%"], ["line", "Line", "64px"], ["status", "Status", "176px"],
];

export function FindingsScreen() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<"all" | Severity>("all");
  const [status, setStatus] = useState("all");
  const [scanner, setScanner] = useState("all");
  const [scope, setScope] = useState<"all" | "review" | "other">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "severity", dir: 1 });
  const [selId, setSelId] = useState<number | null>(null);

  useEffect(() => {
    const p = s.findingsPreset;
    if (!p.nonce) return;
    if (p.scanner !== undefined) setScanner(p.scanner);
    if (p.scope !== undefined) setScope(p.scope);
    if (p.status !== undefined) setStatus(p.status);
    if (p.selId !== undefined) setSelId(p.selId);
    setQ(""); setSev("all");
  }, [s.findingsPreset.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const inReview = useMemo(() => new Set(s.reviewFindings.map((f) => f.id)), [s.reviewFindings]);
  const scanners = useMemo(() => [...new Set(s.findings.map((f) => f.scanner))].sort(), [s.findings]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const key: Record<SortKey, (f: Finding) => string | number> = {
      severity: (f) => SEV_RANK[f.severity], title: (f) => f.title.toLowerCase(), scanner: (f) => f.scanner,
      file: (f) => f.file, line: (f) => f.line, status: (f) => FINDING_STATUSES.indexOf(f.status as never),
    };
    return s.findings
      .filter((f) => (sev === "all" || f.severity === sev)
        && (status === "all" || (status === "unresolved" ? isUnresolved(f.status) : f.status === status))
        && (scanner === "all" || f.scanner === scanner)
        && (scope === "all" || (scope === "review" ? inReview.has(f.id) : !inReview.has(f.id)))
        && (!ql || `${f.id} ${f.title} ${f.file} ${f.rule_id} ${f.message}`.toLowerCase().includes(ql)))
      .sort((a, b) => {
        const ka = key[sort.key](a), kb = key[sort.key](b);
        return ka < kb ? -sort.dir : ka > kb ? sort.dir : SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.id - b.id;
      });
  }, [s.findings, q, sev, status, scanner, scope, sort, inReview]);
  const sel = s.findings.find((f) => f.id === selId) ?? null;
  const unresolved = s.findings.filter((f) => isUnresolved(f.status)).length;
  const clear = () => { setQ(""); setSev("all"); setStatus("all"); setScanner("all"); setScope("all"); };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Findings</h1>
        <span className="caption">{s.findings.length} findings in {s.project?.name ?? "this project"} · {unresolved} unresolved · scanner output is a lead until you confirm it</span>
        <span className="spacer" />
        <button className="cw-btn" onClick={() => s.showScan(null, true)}><Icon name="play" />Start scan</button>
      </div>
      <div className="toolbar">
        <SearchField value={q} onChange={setQ} placeholder="Search title, file, rule or id" label="Search findings" width={260} />
        <Seg label="Severity filter" value={sev} onChange={setSev} options={(["all", "critical", "high", "medium", "low", "info"] as const).map((v) => ({
          value: v, label: v === "all" ? "All" : v === "info" ? "Info" : v[0].toUpperCase() + v.slice(1),
          count: v === "all" ? s.findings.length : s.findings.filter((f) => f.severity === v).length,
        }))} />
        <label className="row" style={{ gap: 6 }}><span className="caption">Status</span>
          <select className="input input-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any</option><option value="unresolved">Unresolved</option>
            {FINDING_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}><span className="caption">Scanner</span>
          <select className="input input-sm" value={scanner} onChange={(e) => setScanner(e.target.value)}>
            <option value="all">Any</option>{scanners.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}><span className="caption">Scope</span>
          <select className="input input-sm" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="all">All revisions</option><option value="review">This review's changeset</option><option value="other">Outside this changeset</option>
          </select>
        </label>
      </div>
      <div className="split">
        <div className="tbl-box">
          {s.findings.length === 0 ? (
            <Empty title="No findings yet" action={<button className="cw-btn cw-btn-primary" onClick={() => s.showScan(null, true)}><Icon name="play" />Start scan</button>}>
              Run Semgrep, Trivy or Gitleaks on a revision. Results appear here with their workflow status.
            </Empty>
          ) : (
            <table className="cw-table">
              <colgroup>{COLS.map(([k, , w]) => <col key={k} style={w ? { width: w } : undefined} />)}</colgroup>
              <thead><tr>{COLS.map(([k, label]) => (
                <th key={k} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button className="th-btn" onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : 1 })}>
                    {label}{sort.key === k && <Icon name={sort.dir === 1 ? "sortUp" : "sortDown"} size={12} />}
                  </button>
                </th>
              ))}</tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} aria-selected={f.id === selId} onClick={() => setSelId(f.id)}>
                    <td><SevBadge sev={f.severity} /></td>
                    <td title={`#${f.id} ${f.title}`}><button className="row-link" onClick={() => setSelId(f.id)}>{f.title}</button></td>
                    <td><span className="cw-signal" title={f.rule_id}><span className="cw-signal-src">{f.scanner.toLowerCase()}</span></span></td>
                    <td className="cw-path" title={f.file}>{f.file}</td>
                    <td className="cw-path cw-num">{f.line}</td>
                    <td><StatusTag status={f.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.findings.length > 0 && rows.length === 0 && (
            <Empty title="No findings match" action={<button className="cw-btn" onClick={clear}>Clear filters</button>}>
              {s.findings.length} findings are hidden by the search and filters. Nothing was deleted.
            </Empty>
          )}
        </div>
        {sel && <FindingDetail f={sel} inReview={inReview.has(sel.id)} onClose={() => setSelId(null)} />}
      </div>
      <div className="tfoot">
        <span className="caption cw-num">Showing {rows.length} of {s.findings.length}</span>
        {rows.length < s.findings.length && <button className="cw-btn cw-btn-sm cw-btn-ghost" onClick={clear}>Clear filters</button>}
      </div>
    </div>
  );
}

function FindingDetail({ f, inReview, onClose }: { f: Finding; inReview: boolean; onClose: () => void }) {
  const s = useStore();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<{ no: number; text: string }[]>([]);
  useEffect(() => { s.api.listNotes(f.id).then(setNotes).catch(() => setNotes([])); }, [f.id, s.api]);
  useEffect(() => {
    setContext([]);
    s.api.fileAt(f.project_id, f.rev, f.file).then((t) => {
      if (!t) return;
      const lines = t.split("\n");
      const from = Math.max(1, f.line - 3), to = Math.min(lines.length, (f.end_line || f.line) + 3);
      const out = [];
      for (let i = from; i <= to; i++) out.push({ no: i, text: lines[i - 1] });
      setContext(out);
    }).catch(() => setContext([]));
  }, [f.id, f.project_id, f.rev, f.file, f.line, f.end_line, s.api]);
  const secretLike = f.scanner === "Gitleaks";
  const add = async () => {
    if (!draft.trim()) return;
    const n = await s.api.addNote(f.id, draft);
    setNotes([...notes, n]); setDraft(""); s.reloadFindings();
  };
  return (
    <aside className="side" aria-label="Finding detail">
      <div className="cw-panel-head"><span className="cw-panel-title">Finding</span><span className="mono muted">#{f.id}</span>
        <div className="cw-panel-actions"><IconBtn icon="x" label="Close finding detail" onClick={onClose} /></div></div>
      <div className="side-body">
        <div className="sec">
          <div className="row wrap" style={{ gap: 6 }}><SevBadge sev={f.severity} /><Provenance scanner={f.scanner} rule={f.rule_id} />
            {f.status === "Confirmed" && <span className="cw-signal cw-signal-analyst"><span className="cw-signal-src">analyst</span>confirmed</span>}</div>
          <h2 className="f-title">{f.title}</h2>
          <label className="row" style={{ justifyContent: "space-between" }}><span className="label">Workflow status</span>
            <select className="input input-sm" style={{ width: 200 }} value={f.status} onChange={(e) => s.setFindingStatus(f.id, e.target.value)}>
              {FINDING_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
        <div className="sec">
          <dl className="dlist">
            <dt>Location</dt><dd className="mono">{f.file}:{f.line}</dd>
            <dt>Revision</dt><dd className="mono">{f.rev}</dd>
            <dt>Rule</dt><dd className="mono">{f.rule_id}</dd>
            <dt>Category</dt><dd>{f.category}{f.cwe ? ` · ${f.cwe}` : ""}</dd>
            <dt>First seen</dt><dd>{fmtTime(f.first_seen)}</dd>
            <dt>Last seen</dt><dd>{fmtTime(f.last_seen)} · run #{f.scan_run_id}</dd>
          </dl>
        </div>
        <div className="sec">
          <span className="label">Evidence</span>
          <p className="evid">{f.message}</p>
          <div className="snip">
            {(secretLike || !context.length) ? (
              <div className="snip-l hl"><span className="dl-ln">{f.line}</span><code>{f.snippet || "—"}</code></div>
            ) : context.map((l) => (
              <div key={l.no} className={"snip-l" + (l.no >= f.line && l.no <= (f.end_line || f.line) ? " hl" : "")}><span className="dl-ln">{l.no}</span><code>{l.text}</code></div>
            ))}
          </div>
          {secretLike && <span className="caption">Secret values are masked; open the file to see the rest of the line.</span>}
        </div>
        <div className="sec">
          <div className="row wrap">
            <button className="cw-btn cw-btn-primary" disabled={!inReview} onClick={() => s.selectFinding(f.id, true)}><Icon name="review" />Open in review</button>
            <button className="cw-btn" disabled={!f.trace} onClick={() => s.openFlow(f.id)}><Icon name="flow" />Explore data flow</button>
          </div>
          {!inReview && <span className="caption">Outside the active review's changeset ({s.review ? `${s.review.base}...${s.review.target}` : "no review open"}).</span>}
        </div>
        <div className="sec">
          <div className="row"><span className="label">Notes</span><span className="spacer" /><span className="caption cw-num">{notes.length}</span></div>
          {notes.map((n) => <div key={n.id} className="note"><div className="note-meta"><b>You</b><span>{fmtTime(n.created_at)}</span></div><span style={{ whiteSpace: "pre-wrap" }}>{n.text}</span></div>)}
          <textarea className="input" aria-label="Add a note" placeholder={`Add a note for #${f.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row"><span className="spacer" /><button className="cw-btn cw-btn-sm" disabled={!draft.trim()} onClick={add}>Add note</button></div>
        </div>
      </div>
    </aside>
  );
}
