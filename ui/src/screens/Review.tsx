import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { Icon } from "../icons";
import { useStore } from "../store";
import { FINDING_STATUSES, isUnresolved, SEV_LABEL, SEV_RANK, type FileDiff, type Finding, type Note, type ReviewFile } from "../types";
import { Banner, basename, dirname, Empty, fmtTime, IconBtn, isSecurityRelevant, Provenance, SearchField, Seg, SevBadge } from "../ui";
import { OpenReviewForm } from "./OpenReview";

type TreeFilter = "all" | "sec" | "unreviewed" | "findings";

export function ReviewScreen() {
  const s = useStore();
  const [leftW, setLeftW] = useState(280);
  const [rightW, setRightW] = useState(360);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [full, setFull] = useState(false);
  const mode = s.settings?.default_diff_mode ?? "unified";

  if (!s.review) return <div className="ov"><OpenReviewForm /></div>;
  const files = s.files;
  const unresolved = s.reviewFindings.filter((f) => isUnresolved(f.status)).length;
  const reviewed = files?.filter((f) => f.reviewed).length ?? 0;
  const adds = files?.reduce((a, f) => a + f.additions, 0) ?? 0;
  const dels = files?.reduce((a, f) => a + f.deletions, 0) ?? 0;
  const sec = files?.filter((f) => isSecurityRelevant(f.path) || s.reviewFindings.some((x) => x.file === f.path)).length ?? 0;
  const showLeft = leftOpen && !focusMode, showRight = rightOpen && !focusMode;

  return (
    <>
      <div className="rv-bar">
        <span className="stat"><b>{files?.length ?? "…"}</b> changed files</span>
        <span className="stat"><span className="add cw-num">+{adds}</span><span className="del cw-num">−{dels}</span> lines</span>
        <span className="stat" title="Files touching auth, data access, config or dependencies, or carrying findings (heuristic)"><Icon name="signal" size={12} /><b>{sec}</b> security-relevant</span>
        <span className="stat"><b style={{ color: unresolved ? "#EE6A77" : undefined }}>{unresolved}</b> unresolved findings</span>
        <span className="stat"><span className="mini-prog" aria-hidden><i style={{ width: `${files?.length ? Math.round((reviewed / files.length) * 100) : 0}%` }} /></span><b>{reviewed}/{files?.length ?? 0}</b> files reviewed</span>
        <span className="spacer" />
        <ScanTargetButton />
        <span className="label">Diff</span>
        <Seg label="Diff mode" value={mode} onChange={(v) => s.updateSettings({ default_diff_mode: v })}
          options={[{ value: "unified", label: "Unified", icon: "unified" }, { value: "split", label: "Side-by-side", icon: "split" }]} />
        <IconBtn small={false} icon="note" label="Inline finding notes" pressed={s.settings?.inline_findings} onClick={() => s.updateSettings({ inline_findings: !s.settings?.inline_findings })} />
        <IconBtn small={false} icon="expand" label="Focus mode — hide side panes" pressed={focusMode} onClick={() => setFocusMode(!focusMode)} />
      </div>
      <div className="panes">
        {showLeft ? (
          <>
            <section className="pane" style={{ width: leftW }} aria-label="Change explorer">
              <ChangeExplorer onCollapse={() => setLeftOpen(false)} />
            </section>
            <Divider onResize={(d) => setLeftW((w) => Math.max(200, Math.min(520, w + d)))} label="Resize change explorer" />
          </>
        ) : (
          <div className="rail"><IconBtn icon="collapseR" label="Expand change explorer" onClick={() => { setLeftOpen(true); setFocusMode(false); }} /><span className="rail-label">Changes</span></div>
        )}
        <section className="pane center" aria-label="Code diff">
          <DiffPane mode={mode} full={full} setFull={setFull} />
        </section>
        {showRight ? (
          <>
            <Divider onResize={(d) => setRightW((w) => Math.max(280, Math.min(600, w - d)))} label="Resize security context" right />
            <section className="pane" style={{ width: rightW }} aria-label="Security context">
              <ContextPane onCollapse={() => setRightOpen(false)} />
            </section>
          </>
        ) : (
          <div className="rail r"><IconBtn icon="collapseL" label="Expand security context" onClick={() => { setRightOpen(true); setFocusMode(false); }} /><span className="rail-label">Security context</span></div>
        )}
      </div>
    </>
  );
}

function ScanTargetButton() {
  const s = useStore();
  const running = s.scans.some((x) => (x.status === "running" || x.status === "queued") && x.rev === s.review?.target && x.project_id === s.review?.project_id);
  const run = async () => {
    if (!s.review || !s.settings) return;
    const enabled = ([["Semgrep", s.settings.semgrep_enabled, "Configured rules"], ["Trivy", s.settings.trivy_enabled, "Dependencies"], ["Gitleaks", s.settings.gitleaks_enabled, "Working tree"]] as const).filter((x) => x[1]);
    for (const [name, , profile] of enabled) await s.startScan(name, s.review.target, profile);
  };
  return (
    <button className="cw-btn cw-btn-sm" onClick={run} disabled={running} title={`Run enabled scanners on ${s.review?.target}`}>
      <Icon name={running ? "spinner" : "play"} spin={running} />{running ? "Scanning…" : "Scan target"}
    </button>
  );
}

function Divider({ onResize, label, right }: { onResize: (dx: number) => void; label: string; right?: boolean }) {
  const last = useRef<number | null>(null);
  return (
    <button className={"divider" + (right ? " r" : "")} aria-label={`${label} (arrow keys)`} title="Drag to resize"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = e.clientX; }}
      onPointerMove={(e) => { if (last.current == null) return; onResize(e.clientX - last.current); last.current = e.clientX; }}
      onPointerUp={() => { last.current = null; }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") onResize(-16); if (e.key === "ArrowRight") onResize(16); }} />
  );
}

/* ------------------------------------------------------------------ explorer */

function ChangeExplorer({ onCollapse }: { onCollapse: () => void }) {
  const s = useStore();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TreeFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const files = s.files ?? [];
  const sigs = useMemo(() => {
    const m = new Map<string, Finding[]>();
    s.reviewFindings.forEach((f) => m.set(f.file, [...(m.get(f.file) ?? []), f]));
    return m;
  }, [s.reviewFindings]);
  const match = (f: ReviewFile, flt: TreeFilter) =>
    flt === "all" || (flt === "sec" && (isSecurityRelevant(f.path) || sigs.has(f.path))) || (flt === "unreviewed" && !f.reviewed) || (flt === "findings" && sigs.has(f.path));
  const vis = files.filter((f) => (!q || f.path.toLowerCase().includes(q.toLowerCase())) && match(f, filter));
  const groups = useMemo(() => {
    const m = new Map<string, ReviewFile[]>();
    vis.forEach((f) => m.set(dirname(f.path), [...(m.get(dirname(f.path)) ?? []), f]));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [vis]);
  const allCollapsed = groups.length > 0 && groups.every(([d]) => collapsed[d]);

  // [ ] and R shortcuts
  useEffect(() => {
    const h = (e: Event) => {
      const k = (e as CustomEvent).detail as string;
      const list = groups.flatMap(([d, fs]) => (collapsed[d] ? [] : fs));
      if (!list.length) return;
      const i = list.findIndex((f) => f.path === s.selPath);
      if (k === "]") s.openFile(list[(i + 1) % list.length].path);
      if (k === "[") s.openFile(list[(i - 1 + list.length) % list.length].path);
      if (k === "r" && s.selPath) {
        const f = files.find((x) => x.path === s.selPath);
        if (f) { s.setFileReviewed(f.path, !f.reviewed); s.notify(`${basename(f.path)} marked ${f.reviewed ? "unreviewed" : "reviewed"}.`); }
      }
    };
    window.addEventListener("acrw:key", h);
    return () => window.removeEventListener("acrw:key", h);
  }, [groups, collapsed, s, files]);

  return (
    <>
      <div className="cw-panel-head">
        <span className="cw-panel-title">Changes</span>
        <span className="caption cw-num">{vis.length} of {files.length}</span>
        <div className="cw-panel-actions">
          <IconBtn icon={allCollapsed ? "chevronDown" : "collapse"} label={allCollapsed ? "Expand all folders" : "Collapse all folders"}
            onClick={() => setCollapsed(Object.fromEntries(groups.map(([d]) => [d, !allCollapsed])))} />
          <IconBtn icon="collapseL" label="Collapse change explorer" onClick={onCollapse} />
        </div>
      </div>
      <div className="pane-tools">
        <SearchField value={q} onChange={setQ} placeholder="Filter files" label="Search changed files" />
        <div className="chips" role="group" aria-label="Change filters">
          {([["all", "All"], ["sec", "Security"], ["unreviewed", "Unreviewed"], ["findings", "Findings"]] as [TreeFilter, string][]).map(([v, label]) => (
            <button key={v} className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>
              {label}<span className="seg-count">{files.filter((f) => match(f, v)).length}</span>
            </button>
          ))}
        </div>
      </div>
      {s.files === null && <div className="loading-bar" aria-label="Loading changes" />}
      <div className="tree" role="tree" aria-label="Changed files">
        {s.filesError && <div style={{ padding: 12 }}><Banner kind="danger" title="Could not read the changeset.">{s.filesError}</Banner></div>}
        {groups.map(([dir, fs]) => (
          <div key={dir} role="group">
            <button className="cw-tree-row" onClick={() => setCollapsed({ ...collapsed, [dir]: !collapsed[dir] })} aria-expanded={!collapsed[dir]}>
              <Icon name={collapsed[dir] ? "chevronRight" : "chevronDown"} size={12} style={{ color: "#92949D" }} />
              <span className="cw-tree-name cw-tree-dir" title={dir || "(repository root)"}>{dir ? dir + "/" : "(repository root)"}</span>
              <span className="caption cw-num">{fs.length}</span>
            </button>
            {!collapsed[dir] && fs.map((f) => {
              const open = (sigs.get(f.path) ?? []).filter((x) => isUnresolved(x.status)).length;
              return (
                <button key={f.path} className="cw-tree-row d1" role="treeitem" aria-selected={f.path === s.selPath} onClick={() => s.openFile(f.path)}
                  title={f.path + (f.old_path ? ` (renamed from ${f.old_path})` : "")}>
                  <span className={`cw-change cw-change-${f.status}`} aria-label={{ A: "Added", M: "Modified", D: "Deleted", R: "Renamed" }[f.status]}>{f.status}</span>
                  <span className={"cw-tree-name" + (f.status === "D" ? " strike" : "")}>{basename(f.path)}</span>
                  {open > 0 && <span className="cw-tree-sig" title={`${open} unresolved`}><Icon name="findings" size={12} />{open}</span>}
                  <span className="cw-tree-stat">{f.binary ? "bin" : `${f.additions ? "+" + f.additions : ""}${f.additions && f.deletions ? " " : ""}${f.deletions ? "−" + f.deletions : ""}`}</span>
                  <span className={"cw-review-dot " + (f.reviewed ? "rd-done" : "rd-todo")} title={f.reviewed ? "Reviewed" : "Not reviewed"} aria-label={f.reviewed ? "Reviewed" : "Not reviewed"} />
                </button>
              );
            })}
          </div>
        ))}
        {s.files && files.length === 0 && !s.filesError && (
          <div style={{ padding: "16px 12px" }} className="col"><span className="set-label">No changes</span><span className="caption">{s.review?.target} has no commits since its merge base with {s.review?.base}.</span></div>
        )}
        {s.files && files.length > 0 && vis.length === 0 && (
          <div style={{ padding: "16px 12px" }} className="col">
            <span className="set-label">No files match</span>
            <span className="caption">{files.length} changed files are hidden by the search or filter.</span>
            <button className="cw-btn cw-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => { setQ(""); setFilter("all"); }}>Clear filters</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ diff */

function DiffPane({ mode, full, setFull }: { mode: "unified" | "split"; full: boolean; setFull: (v: boolean) => void }) {
  const s = useStore();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decoRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const zonesRef = useRef<string[]>([]);
  const [mounted, setMounted] = useState(0);
  const file = s.files?.find((f) => f.path === s.selPath) ?? null;
  const fileFindings = useMemo(() => s.reviewFindings.filter((f) => f.file === s.selPath), [s.reviewFindings, s.selPath]);
  const latest = useRef({ fileFindings, select: s.selectFinding });
  latest.current = { fileFindings, select: s.selectFinding };

  useEffect(() => {
    if (!s.review || !file) { setDiff(null); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    s.api.fileDiff(s.review.id, file.path, file.old_path)
      .then((d) => { if (alive) setDiff(d); })
      .catch((e) => { if (alive) { setError(String(e?.message ?? e)); setDiff(null); } })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [s.review?.id, file?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMount: DiffOnMount = (ed, monaco) => {
    edRef.current = ed;
    monacoRef.current = monaco as unknown as typeof Monaco;
    const mod = ed.getModifiedEditor();
    decoRef.current = mod.createDecorationsCollection([]);
    mod.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = e.target.position?.lineNumber;
      const hit = latest.current.fileFindings.find((f) => f.line === line);
      if (hit) latest.current.select(hit.id);
    });
    setMounted((n) => n + 1);
  };

  // finding markers, selected-line highlight and inline notes
  useEffect(() => {
    const ed = edRef.current, monaco = monacoRef.current;
    if (!ed || !monaco || !diff) return;
    const mod = ed.getModifiedEditor();
    const model = mod.getModel();
    if (!model) return;
    const max = model.getLineCount();
    const list = [...fileFindings].filter((f) => f.line >= 1 && f.line <= max).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
    decoRef.current?.set(list.map((f) => ({
      range: new monaco.Range(f.line, 1, f.line, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: `acrw-glyph sev-${f.severity}${isUnresolved(f.status) ? "" : " done"}`,
        glyphMarginHoverMessage: { value: `**${f.title}** · ${SEV_LABEL[f.severity]} · ${f.status}\n\n${f.scanner} \`${f.rule_id}\`` },
        className: f.id === s.selFindingId ? "acrw-line-sel" : "acrw-line-flag",
      },
    })));
    mod.changeViewZones((acc) => {
      zonesRef.current.forEach((z) => acc.removeZone(z));
      zonesRef.current = [];
      if (!s.settings?.inline_findings) return;
      const byLine = new Map<number, Finding[]>();
      list.forEach((f) => { const k = f.end_line && f.end_line <= max ? f.end_line : f.line; byLine.set(k, [...(byLine.get(k) ?? []), f]); });
      byLine.forEach((fs, line) => {
        const node = document.createElement("div");
        node.className = "note-row";
        node.style.paddingLeft = "8px";
        fs.forEach((f) => {
          const b = document.createElement("button");
          b.className = "dnote" + (f.id === s.selFindingId ? " sel" : "");
          b.style.cursor = "pointer";
          b.style.marginBottom = "4px";
          b.innerHTML = "";
          const sev = document.createElement("span"); sev.className = `cw-sev cw-sev-${f.severity}`; sev.textContent = SEV_LABEL[f.severity];
          const t = document.createElement("span"); t.className = "dnote-title"; t.textContent = f.title;
          const st = document.createElement("span"); st.className = "caption"; st.textContent = `${f.scanner} · ${f.status}`;
          b.append(sev, t, st);
          b.onclick = () => latest.current.select(f.id);
          node.appendChild(b);
        });
        zonesRef.current.push(acc.addZone({ afterLineNumber: line, heightInPx: 36 * fs.length + 4, domNode: node }));
      });
    });
  }, [diff, fileFindings, s.selFindingId, s.settings?.inline_findings, mounted]);

  // reveal a requested line
  useEffect(() => {
    const ed = edRef.current;
    if (!ed || !diff || s.focus.line == null) return;
    const mod = ed.getModifiedEditor();
    const line = s.focus.line;
    const t = window.setTimeout(() => { mod.revealLineInCenter(line); mod.setPosition({ lineNumber: line, column: 1 }); }, 80);
    return () => window.clearTimeout(t);
  }, [s.focus.nonce, diff, mounted]);

  if (!s.files) return <div className="loading-bar" />;
  if (!file) return <div className="center-msg"><Empty title="No file selected">Choose a file in the change explorer.</Empty></div>;
  const fontSize = s.settings?.code_font_size ?? 12.5;
  return (
    <>
      <div className="cw-diff-file">
        <Icon name="file" style={{ color: "#92949D" }} />
        <span className="path-full" style={{ flex: 1 }} title={file.path}>{file.path}</span>
        <span className="ftag">{{ A: "Added", M: "Modified", D: "Deleted", R: "Renamed" }[file.status]}</span>
        <span className="cw-tree-stat"><span style={{ color: "#65B889" }}>+{file.additions}</span> <span style={{ color: "#EE6A77" }}>−{file.deletions}</span></span>
        <IconBtn icon="prev" label="Previous file  [" onClick={() => window.dispatchEvent(new CustomEvent("acrw:key", { detail: "[" }))} />
        <IconBtn icon="next" label="Next file  ]" onClick={() => window.dispatchEvent(new CustomEvent("acrw:key", { detail: "]" }))} />
        <button className="cw-btn cw-btn-sm" aria-pressed={full} onClick={() => setFull(!full)} title="Show the whole file instead of collapsing unchanged regions">
          <Icon name="fullfile" />{full ? "Diff only" : "Full file"}
        </button>
        <button className="cw-btn cw-btn-sm" onClick={() => { s.setFileReviewed(file.path, !file.reviewed); s.notify(`${basename(file.path)} marked ${file.reviewed ? "unreviewed" : "reviewed"}.`); }}>
          <Icon name="check" />{file.reviewed ? "Mark unreviewed" : "Mark file reviewed"}
        </button>
      </div>
      <div className="diff-meta">
        <span className="mono muted">{s.review?.base}@{diff?.base_commit ?? "…"}</span>
        <Icon name="arrowRight" size={12} style={{ color: "#92949D" }} />
        <span className="mono">{s.review?.target}@{diff?.target_commit ?? "…"}</span>
        <span className="caption">· {file.old_path ? `renamed from ${file.old_path}` : diff?.language ?? ""} · {fileFindings.length} signals</span>
        <span className="spacer" />
        <span className={"cw-review " + (file.reviewed ? "rd-done" : "")}><span className="cw-review-dot" /><span>{file.reviewed ? "File reviewed" : "Not reviewed"}</span></span>
      </div>
      {loading && <div className="loading-bar" aria-label="Loading diff" />}
      {error && <div style={{ padding: 12 }}><Banner kind="danger" title="Could not load this file.">{error}</Banner></div>}
      {diff?.binary && <div className="center-msg"><Empty title="Binary file">ACRW does not diff binary content.</Empty></div>}
      {diff && !diff.binary && (
        <div className="monaco-host">
          <DiffEditor
            key={mode}
            theme="acrw"
            original={diff.original ?? ""}
            modified={diff.modified ?? ""}
            language={diff.language}
            originalModelPath={`acrw-orig://${s.review?.id}/${diff.old_path ?? diff.path}`}
            modifiedModelPath={`acrw-mod://${s.review?.id}/${diff.path}`}
            onMount={onMount}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            loading={<div className="loading-bar" />}
            options={{
              readOnly: true, originalEditable: false, renderSideBySide: mode === "split", useInlineViewWhenSpaceIsLimited: false,
              glyphMargin: true, minimap: { enabled: false }, renderOverviewRuler: false, scrollBeyondLastLine: false,
              fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace', fontSize, lineHeight: 20, automaticLayout: true,
              hideUnchangedRegions: { enabled: !full, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
              stickyScroll: { enabled: false }, renderLineHighlight: "none", diffAlgorithm: "advanced", ignoreTrimWhitespace: false,
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            }}
          />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ context */

function ContextPane({ onCollapse }: { onCollapse: () => void }) {
  const s = useStore();
  const rf = useMemo(() => [...s.reviewFindings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line), [s.reviewFindings]);
  const sel = s.findings.find((f) => f.id === s.selFindingId) ?? null;
  const fileSigs = rf.filter((f) => f.file === s.selPath);
  const idx = rf.findIndex((f) => f.id === s.selFindingId);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // pick the first signal of a newly opened file
  useEffect(() => {
    if (fileSigs.length && !fileSigs.some((f) => f.id === s.selFindingId)) s.selectFinding(fileSigs[0].id);
  }, [s.selPath, rf.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setConfirm(false);
    if (!sel) { setNotes([]); return; }
    s.api.listNotes(sel.id).then(setNotes).catch(() => setNotes([]));
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (d: number) => { if (rf.length) s.selectFinding(rf[(Math.max(idx, 0) + d + rf.length) % rf.length].id, true); };
  useEffect(() => {
    const h = (e: Event) => { const k = (e as CustomEvent).detail; if (k === "j") move(1); if (k === "k") move(-1); };
    window.addEventListener("acrw:key", h);
    return () => window.removeEventListener("acrw:key", h);
  });

  const addNote = async () => {
    if (!sel || !draft.trim()) return;
    try {
      const n = await s.api.addNote(sel.id, draft);
      setNotes([...notes, n]);
      setDraft("");
      s.notify(`Note added to #${sel.id}.`);
      s.reloadFindings();
    } catch (e) { s.notify(String((e as Error).message ?? e)); }
  };
  const related = sel?.trace?.source && (sel.trace.source.file !== sel.file || sel.trace.source.line !== sel.line) ? sel.trace.source : null;
  const inReview = sel ? rf.some((f) => f.id === sel.id) : false;

  return (
    <>
      <div className="cw-panel-head">
        <span className="cw-panel-title">Security context</span>
        <span className="caption cw-num">{idx >= 0 ? `${idx + 1} of ${rf.length}` : `${rf.length} signals`}</span>
        <div className="cw-panel-actions">
          <IconBtn icon="up" label="Previous signal  K" onClick={() => move(-1)} disabled={!rf.length} />
          <IconBtn icon="down" label="Next signal  J" onClick={() => move(1)} disabled={!rf.length} />
          <IconBtn icon="collapseR" label="Collapse security context" onClick={onCollapse} />
        </div>
      </div>
      <div className="ctx-body">
        <div className="sec">
          <div className="row"><span className="label">Signals in this file</span><span className="spacer" /><span className="caption cw-num">{fileSigs.length}</span></div>
          {fileSigs.map((f) => (
            <button key={f.id} className="sig-row" aria-selected={f.id === s.selFindingId} onClick={() => s.selectFinding(f.id, true)}>
              <span className={`mk mk-${f.severity}${isUnresolved(f.status) ? "" : " mk-done"}`} aria-hidden><i /></span>
              <span className="sig-title">{f.title}</span>
              <span className="mono muted">L{f.line}</span>
            </button>
          ))}
          {fileSigs.length === 0 && (
            <span className="caption">
              {rf.length ? `No signals on this file. ${rf.length} elsewhere in this review — J / K to step through.` : `No scanner results for ${s.review?.target} yet. Use “Scan target” to run the enabled scanners locally.`}
            </span>
          )}
        </div>
        {sel && (
          <>
            <div className="sec">
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="mono muted">#{sel.id}</span>
                <SevBadge sev={sel.severity} />
                <Provenance scanner={sel.scanner} rule={sel.rule_id} />
              </div>
              <h2 className="f-title">{sel.title}</h2>
              {sel.file !== s.selPath && <span className="caption">In another file: <button className="loc-link" onClick={() => s.selectFinding(sel.id, true)}>{sel.file}:{sel.line}</button></span>}
              {!inReview && <span className="caption">Not part of this changeset ({sel.rev}).</span>}
              <label className="row" style={{ justifyContent: "space-between" }}>
                <span className="label">Workflow status</span>
                <select className="input input-sm" style={{ width: 200 }} value={sel.status} onChange={(e) => s.setFindingStatus(sel.id, e.target.value)} aria-label={`Workflow status for #${sel.id}`}>
                  {FINDING_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <span className="caption">Severity is the scanner's estimate; the workflow status is your decision. Scanner output is a lead until you confirm it.</span>
            </div>
            <div className="sec">
              <dl className="dlist">
                <dt>Category</dt><dd>{sel.category || "—"}{sel.cwe ? ` · ${sel.cwe}` : ""}</dd>
                <dt>Source</dt><dd>{sel.trace?.source ? <button className="loc-link" onClick={() => s.openFile(sel.trace!.source!.file, sel.trace!.source!.line)}>{sel.trace.source.file}:{sel.trace.source.line}</button> : <span className="muted">Not reported by the scanner</span>}</dd>
                <dt>Sink or sensitive op</dt><dd>{sel.trace?.sink ? <span className="mono">{sel.trace.sink.content || `${sel.trace.sink.file}:${sel.trace.sink.line}`}</span> : <span className="muted">Not reported by the scanner</span>}</dd>
                <dt>Location</dt><dd><button className="loc-link" onClick={() => s.selectFinding(sel.id, true)}>{sel.file}:{sel.line}</button></dd>
                <dt>Rule</dt><dd className="mono">{sel.rule_id}</dd>
                <dt>First seen</dt><dd>{fmtTime(sel.first_seen)} · {sel.rev}</dd>
              </dl>
            </div>
            <div className="sec">
              <span className="label">Evidence</span>
              <p className="evid">{sel.message}</p>
              {sel.snippet && <div className="code-line">{sel.snippet}</div>}
            </div>
            <div className="sec">
              <div className="act-grid">
                <button className="cw-btn" disabled={!related} onClick={() => related && s.openFile(related.file, related.line)} title={related ? `${related.file}:${related.line}` : "No related location reported"}><Icon name="ext" />Open related code</button>
                <button className="cw-btn" disabled={!sel.trace} onClick={() => s.openFlow(sel.id)}><Icon name="flow" />Explore data flow</button>
                <button className="cw-btn" onClick={() => { noteRef.current?.focus(); noteRef.current?.scrollIntoView({ block: "nearest" }); }}><Icon name="note" />Add review note</button>
                <button className="cw-btn" disabled={sel.status === "Reviewed — no issue"} onClick={() => setConfirm(true)}><Icon name="check" />Mark as reviewed</button>
              </div>
              {!sel.trace && <span className="caption">No dataflow trace for this result. Taint rules (Semgrep) produce traces.</span>}
              {confirm && (
                <Banner kind="warning" title="Confirm." actions={<><button className="cw-btn cw-btn-sm cw-btn-primary" onClick={() => { s.setFindingStatus(sel.id, "Reviewed — no issue"); setConfirm(false); }}>Mark reviewed</button><button className="cw-btn cw-btn-sm" onClick={() => setConfirm(false)}>Cancel</button></>}>
                  Mark #{sel.id} “{sel.title}” as Reviewed — no issue?
                </Banner>
              )}
            </div>
            <div className="sec">
              <div className="row"><span className="label">Assistant</span><span className="spacer" />
                <button className={"cw-provider " + (s.settings?.ai_enabled ? "cw-provider-local" : "cw-provider-off")} onClick={() => s.go("settings")}><span className="cw-provider-dot" />{s.settings?.ai_enabled ? "Enabled (not in MVP)" : "AI off"}</button>
              </div>
              <span className="caption">AI assistance is not part of this MVP. Nothing is sent anywhere.</span>
            </div>
            <div className="sec">
              <div className="row"><span className="label">Review notes</span><span className="spacer" /><span className="caption cw-num">{notes.length}</span></div>
              {notes.map((n) => <div key={n.id} className="note"><div className="note-meta"><b>You</b><span>{fmtTime(n.created_at)}</span></div><span style={{ whiteSpace: "pre-wrap" }}>{n.text}</span></div>)}
              <label className="sr" htmlFor="note-input">Add a review note</label>
              <textarea id="note-input" ref={noteRef} className="input" placeholder="What you checked and what you found" value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote(); }} />
              <div className="row"><span className="caption">Stored locally. Ctrl/⌘ + Enter adds.</span><span className="spacer" /><button className="cw-btn cw-btn-sm" disabled={!draft.trim()} onClick={addNote}>Add note</button></div>
            </div>
          </>
        )}
        {!sel && rf.length > 0 && <div className="sec"><span className="caption">Select a signal to see its evidence.</span></div>}
      </div>
    </>
  );
}
