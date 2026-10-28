import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { useStore } from "../store";
import type { Finding, TraceNode } from "../types";
import { Banner, Empty, IconBtn, SearchField, SevBadge, StatusTag } from "../ui";

const NW = 300, NH = 56, GAP = 44;
type Kind = "source" | "step" | "sink";
interface GNode extends TraceNode { id: string; kind: Kind; x: number; y: number }

function nodesFor(f: Finding): GNode[] {
  const t = f.trace;
  if (!t) return [];
  const raw: [Kind, TraceNode][] = [];
  if (t.source) raw.push(["source", t.source]);
  t.steps.forEach((s) => raw.push(["step", s]));
  if (t.sink) raw.push(["sink", t.sink]);
  const out: GNode[] = [];
  raw.forEach(([kind, n]) => {
    const prev = out[out.length - 1];
    if (prev && prev.file === n.file && prev.line === n.line && kind === "step") return; // same location as previous
    out.push({ ...n, kind, id: `${kind}-${out.length}`, x: 24, y: 24 + out.length * (NH + GAP) });
  });
  return out;
}
const ROLE: Record<Kind, [string, string, string]> = {
  source: ["SRC", "cw-flow-role-source", "Source"], step: ["FN", "cw-flow-role-step", "Intermediate"], sink: ["SNK", "cw-flow-role-sink", "Sink"],
};

export function FlowScreen() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const paths = useMemo(() => s.findings.filter((f) => f.trace && (f.trace.source || f.trace.sink)), [s.findings]);
  const vis = paths.filter((f) => !q || `${f.title} ${f.file} ${f.rule_id} ${f.trace?.source?.content} ${f.trace?.sink?.content}`.toLowerCase().includes(q.toLowerCase()));
  const sel = paths.find((f) => f.id === s.flowFindingId) ?? vis[0] ?? null;
  useEffect(() => setNodeId(null), [sel?.id]);
  const nodes = sel ? nodesFor(sel) : [];
  const node = nodes.find((n) => n.id === nodeId) ?? null;
  const w = NW + 48, h = nodes.length ? nodes[nodes.length - 1].y + NH + 24 : 200;
  const inReview = (file: string) => !!s.files?.some((x) => x.path === file) && sel?.rev === s.review?.target;

  return (
    <div className="panes">
      <aside className="flow-list" aria-label="Detected paths">
        <div className="cw-panel-head"><span className="cw-panel-title">Paths</span><span className="caption cw-num">{paths.length}</span></div>
        <div className="pane-tools"><SearchField value={q} onChange={setQ} placeholder="Search source, sink or file" label="Search paths" /></div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {vis.map((f) => (
            <button key={f.id} className="path-row" aria-selected={f.id === sel?.id} onClick={() => s.openFlow(f.id)}>
              <span className="row"><span className="mono muted">#{f.id}</span><SevBadge sev={f.severity} /><span className="spacer" /><span className="caption">{nodesFor(f).length - 1} hops</span></span>
              <span className="path-sum">{f.file}:{f.trace?.source?.line ?? "?"} → {f.trace?.sink?.line ?? f.line}</span>
              <span className="caption">{f.title}</span>
            </button>
          ))}
          {paths.length > 0 && vis.length === 0 && <div className="col" style={{ padding: "16px 12px" }}><span className="set-label">No paths match</span><button className="cw-btn cw-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setQ("")}>Clear search</button></div>}
        </div>
      </aside>
      <section className="graph-wrap" aria-label="Data-flow graph">
        {!sel ? (
          <div className="center-msg"><Empty title="No source → sink paths yet">
            Paths come from Semgrep taint rules (for example the bundled acrw-python rules). Run Semgrep on a revision and results with a dataflow trace appear here.
          </Empty></div>
        ) : (
          <>
            <div className="graph-tools">
              <span className="mono">#{sel.id}</span><span className="caption" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel.title}</span>
              <span className="spacer" />
              <div className="legend"><span><i className="lg-line" />reported by scanner</span></div>
              <IconBtn icon="zoomOut" label="Zoom out" onClick={() => setZoom(Math.max(0.6, +(zoom - 0.1).toFixed(2)))} />
              <span className="caption cw-num" style={{ width: 36, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
              <IconBtn icon="zoomIn" label="Zoom in" onClick={() => setZoom(Math.min(1.6, +(zoom + 0.1).toFixed(2)))} />
              <IconBtn icon="fit" label="Reset zoom" onClick={() => setZoom(1)} />
            </div>
            <div style={{ padding: "10px 12px 0", flex: "none" }}>
              <Banner kind="warning" title="A lead, not proof.">
                {sel.scanner} reported this path inside one function (open-source Semgrep taint analysis is intraprocedural). Callers and callees outside it are not shown, and sanitisers it does not model are not considered.
              </Banner>
            </div>
            <div className="graph-scroll">
              <div className="graph-sizer" style={{ width: w * zoom, height: h * zoom }}>
                <div className="graph" style={{ width: w, height: h, transform: `scale(${zoom})` }}>
                  <svg className="gedges" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
                    <defs><marker id="ar-sel" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" style={{ fill: "#B51F32" }} /></marker></defs>
                    {nodes.slice(1).map((n, i) => {
                      const a = nodes[i];
                      return <path key={n.id} className="e e-sel" d={`M${a.x + NW / 2} ${a.y + NH} V${n.y - 2}`} style={{ markerEnd: "url(#ar-sel)" }} />;
                    })}
                  </svg>
                  {nodes.map((n) => (
                    <button key={n.id} className={"gnode on-path" + (n.id === nodeId ? " sel" : "")} style={{ left: n.x, top: n.y, width: NW }} aria-pressed={n.id === nodeId}
                      aria-label={`${ROLE[n.kind][2]}: ${n.file}:${n.line}`} onClick={() => setNodeId(n.id === nodeId ? null : n.id)}>
                      <span className={"cw-flow-role " + ROLE[n.kind][1]}>{ROLE[n.kind][0]}</span>
                      <span className="gsym">{n.content || "(no source text)"}</span>
                      <span className="gdesc">{n.file}:{n.line}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      <aside className="ev-panel" aria-label="Evidence">
        <div className="cw-panel-head"><span className="cw-panel-title">Evidence</span>
          <div className="cw-panel-actions">{node && <button className="cw-btn cw-btn-sm cw-btn-ghost" onClick={() => setNodeId(null)}>Path summary</button>}</div></div>
        <div className="ctx-body">
          {sel && node && (
            <div className="sec">
              <div className="row"><span className={"cw-flow-role " + ROLE[node.kind][1]}>{ROLE[node.kind][0]}</span><span className="caption">{ROLE[node.kind][2]}</span></div>
              <div className="code-line">{node.content || "—"}</div>
              <dl className="dlist">
                <dt>Location</dt><dd className="mono">{node.file}:{node.line}</dd>
                <dt>In changeset</dt><dd>{inReview(node.file) ? "Yes" : "No"}</dd>
              </dl>
              <button className="cw-btn cw-btn-sm" style={{ alignSelf: "flex-start" }} disabled={!inReview(node.file)} onClick={() => s.openFile(node.file, node.line)}><Icon name="ext" />Open in diff</button>
              {!inReview(node.file) && <span className="caption">This location is not in the open review's changeset.</span>}
            </div>
          )}
          {sel && !node && (
            <>
              <div className="sec">
                <span className="label">Signal</span>
                <span style={{ fontWeight: 600 }}>{sel.title}</span>
                <div className="row wrap"><SevBadge sev={sel.severity} /><StatusTag status={sel.status} /></div>
                <p className="evid">{sel.message}</p>
                <dl className="dlist">
                  <dt>Rule</dt><dd className="mono">{sel.rule_id}</dd>
                  <dt>Revision</dt><dd className="mono">{sel.rev}</dd>
                  <dt>Hops</dt><dd className="cw-num">{Math.max(0, nodes.length - 1)}</dd>
                </dl>
              </div>
              <div className="sec">
                <span className="label">Steps</span>
                {nodes.map((n) => (
                  <div key={n.id} className="edge-row">
                    <span className={"cw-flow-role " + ROLE[n.kind][1]}>{ROLE[n.kind][0]}</span>
                    <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.content}>L{n.line} {n.content}</span>
                  </div>
                ))}
                <span className="caption">Select a node to see where it is and open it in the diff.</span>
              </div>
              <div className="sec"><div className="row wrap">
                <button className="cw-btn cw-btn-sm" disabled={!inReview(sel.file)} onClick={() => s.selectFinding(sel.id, true)}><Icon name="review" />Open in review</button>
                <button className="cw-btn cw-btn-sm" onClick={() => s.showFindings({ selId: sel.id, scope: "all", status: "all", scanner: "all" })}><Icon name="findings" />Open finding</button>
              </div></div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
