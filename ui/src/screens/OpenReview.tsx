import { useEffect, useState } from "react";
import { Icon, RavenMark } from "../icons";
import { useStore } from "../store";
import { isTauri } from "../api";
import { Banner } from "../ui";

/** First run and "start a review": pick a repository and base...target. */
export function OpenReviewForm({ compact }: { compact?: boolean }) {
  const s = useStore();
  const [projectId, setProjectId] = useState<number | null>(s.review?.project_id ?? s.projects[0]?.id ?? null);
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (projectId == null && s.projects[0]) setProjectId(s.projects[0].id); }, [s.projects, projectId]);
  useEffect(() => {
    if (projectId == null) return;
    setErr(null);
    s.api.listBranches(projectId).then((b) => {
      setBranches(b.branches);
      const bs = b.default_base ?? b.branches[0] ?? "";
      setBase(bs);
      setTarget((b.current && b.current !== bs ? b.current : b.branches.find((x) => x !== bs)) ?? "");
    }).catch((e) => setErr(String(e?.message ?? e)));
  }, [projectId, s.api]);

  const addRepo = async () => {
    setErr(null);
    try {
      const path = await s.api.pickFolder();
      if (!path) return;
      const p = await s.api.addProject(path);
      await s.reloadProjects();
      setProjectId(p.id);
      s.notify(`${p.name} added.`);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  };
  const open = async () => {
    if (projectId == null) return;
    setBusy(true);
    const ok = await s.openReview(projectId, base, target);
    setBusy(false);
    if (ok) s.go("review");
  };

  return (
    <div className={compact ? "col" : "welcome"}>
      {!compact && <RavenMark size={40} />}
      {!compact && <h1>{s.projects.length ? "Start a review" : "Open a repository"}</h1>}
      {!compact && <p className="muted" style={{ margin: 0 }}>ACRW reviews a Git changeset — everything on a target branch since it left its base — next to Semgrep, Trivy and Gitleaks results. It reads your repository and never writes to it; scans run in a temporary worktree on this machine.</p>}
      {!isTauri && !compact && <Banner kind="info" title="Browser demo.">This build runs without the desktop backend and shows a recorded demo repository. Run <span className="mono">npm run tauri dev</span> for the real app.</Banner>}
      {err && <Banner kind="danger" title="Could not open.">{err}</Banner>}
      <div className="row wrap">
        <label className="fld" style={{ minWidth: 220 }}><span className="caption">Repository</span>
          <select className="input" value={projectId ?? ""} onChange={(e) => setProjectId(Number(e.target.value))} disabled={!s.projects.length}>
            {!s.projects.length && <option value="">No repositories yet</option>}
            {s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="cw-btn" style={{ alignSelf: "flex-end" }} onClick={addRepo} disabled={!isTauri} title={isTauri ? "Choose a folder inside a Git work tree" : "Not available in the browser demo"}>
          <Icon name="folder" />Add repository…
        </button>
      </div>
      {projectId != null && (
        <div className="pick-row">
          <label className="fld"><span className="caption">Base</span>
            <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          </label>
          <label className="fld"><span className="caption">Target</span>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          </label>
          <button className="cw-btn cw-btn-primary cw-btn-lg" onClick={open} disabled={busy || !base || !target || base === target}>
            <Icon name="review" />{busy ? "Opening…" : "Open review"}
          </button>
        </div>
      )}
      {projectId != null && base && base === target && <span className="caption">Pick a target different from the base.</span>}
    </div>
  );
}
