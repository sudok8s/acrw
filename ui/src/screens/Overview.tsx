import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useStore } from "../store";
import { isUnresolved, SEV_RANK, type ReviewSummary } from "../types";
import { basename, fmtTime, ScanState, SevBadge, StatusTag } from "../ui";
import { OpenReviewForm } from "./OpenReview";

export function OverviewScreen() {
  const s = useStore();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [startOpen, setStartOpen] = useState(false);
  useEffect(() => { s.api.listReviews().then(setReviews).catch(() => setReviews([])); }, [s.api, s.review, s.findings]);
  const unresolved = s.findings.filter((f) => isUnresolved(f.status)).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const reviewed = s.files?.filter((f) => f.reviewed).length ?? 0;
  const projectName = (id: number) => s.projects.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="ov">
      {s.review ? (
        <div className="resume">
          <div className="col" style={{ gap: 2 }}>
            <span className="label">Resume where you left off</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{s.project?.name} <span className="mono muted" style={{ fontWeight: 400 }}>{s.review.base}...{s.review.target}</span></span>
            <span className="caption">{s.review.status} · {reviewed}/{s.files?.length ?? 0} files reviewed · {s.reviewFindings.filter((f) => isUnresolved(f.status)).length} unresolved in this changeset{s.selPath ? ` · last file ${basename(s.selPath)}` : ""}</span>
          </div>
          <span className="spacer" />
          <div className="qa">
            <button className="cw-btn cw-btn-primary cw-btn-lg" onClick={() => s.go("review")}><Icon name="review" />Resume review</button>
            <button className="cw-btn cw-btn-lg" onClick={() => setStartOpen(!startOpen)} aria-expanded={startOpen}><Icon name="folder" />Open repository or branch</button>
            <button className="cw-btn cw-btn-lg" onClick={() => s.showScan(null, true)}><Icon name="play" />Start scan</button>
          </div>
        </div>
      ) : null}
      {(!s.review || startOpen) && <div className="form-panel" style={{ margin: "0 0 16px" }}><OpenReviewForm compact={!!s.review} /></div>}
      <div className="ov-grid">
        <div className="col" style={{ gap: 16 }}>
          <section className="box" aria-label="Recent reviews">
            <div className="cw-panel-head"><span className="cw-panel-title">Recent reviews</span></div>
            <table className="cw-table">
              <colgroup><col style={{ width: 160 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 80 }} /><col style={{ width: 96 }} /><col style={{ width: 120 }} /></colgroup>
              <thead><tr><th>Project</th><th>Comparison</th><th>Status</th><th>Reviewed</th><th>Unresolved</th><th>Updated</th></tr></thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.review.id} onClick={() => s.openReview(r.review.project_id, r.review.base, r.review.target).then((ok) => ok && s.go("review"))}>
                    <td><button className="row-link">{r.project_name}</button></td>
                    <td className="cw-path" title={`${r.review.base}...${r.review.target}`}>{r.review.base}...{r.review.target}</td>
                    <td><span className={"cw-review " + (r.review.status === "Approved" ? "rd-done" : "cw-review-in-review")}><span className="cw-review-dot" /><span style={{ color: "#E6E6E8" }}>{r.review.status}</span></span></td>
                    <td className="cw-num">{r.reviewed_count} files</td>
                    <td className="cw-num">{r.unresolved}</td>
                    <td className="caption">{fmtTime(r.review.updated_at)}</td>
                  </tr>
                ))}
                {!reviews.length && <tr><td colSpan={6} className="caption">No reviews yet.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="box" aria-label="Unresolved findings">
            <div className="cw-panel-head"><span className="cw-panel-title">Unresolved findings</span><span className="caption cw-num">{unresolved.length}</span>
              <div className="cw-panel-actions"><button className="cw-btn cw-btn-sm cw-btn-ghost" onClick={() => s.showFindings({ status: "unresolved", scope: "all", scanner: "all", selId: null })}>All findings</button></div></div>
            <div>
              {unresolved.slice(0, 8).map((f) => (
                <button key={f.id} className="li" onClick={() => s.showFindings({ selId: f.id, status: "all", scope: "all", scanner: "all" })}>
                  <span style={{ width: 112 }}><SevBadge sev={f.severity} /></span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.title}</span>
                  <span className="mono muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{basename(f.file)}:{f.line}</span>
                  <StatusTag status={f.status} />
                </button>
              ))}
              {!unresolved.length && <div className="caption" style={{ padding: "8px 12px" }}>Nothing unresolved{s.findings.length ? "" : " — no scan results yet"}.</div>}
            </div>
          </section>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <section className="box" aria-label="Scan jobs">
            <div className="cw-panel-head"><span className="cw-panel-title">Scan jobs</span><div className="cw-panel-actions"><button className="cw-btn cw-btn-sm cw-btn-ghost" onClick={() => s.go("scans")}>Scan center</button></div></div>
            <div>
              {s.scans.slice(0, 6).map((r) => (
                <button key={r.id} className="li" onClick={() => s.showScan(r.id)}>
                  <span style={{ width: 104 }}><ScanState status={r.status} /></span>
                  <span className="nowrap" style={{ flex: 1, minWidth: 0 }}>{r.scanner} <span className="mono muted">{r.rev}</span></span>
                  <span className="caption">{projectName(r.project_id)} · {fmtTime(r.started_at)}</span>
                </button>
              ))}
              {!s.scans.length && <div className="caption" style={{ padding: "8px 12px" }}>No scans yet.</div>}
            </div>
          </section>
          <section className="box" aria-label="Repositories">
            <div className="cw-panel-head"><span className="cw-panel-title">Repositories</span><div className="cw-panel-actions"><button className="cw-btn cw-btn-sm cw-btn-ghost" onClick={() => s.go("projects")}>Projects</button></div></div>
            <div>
              {s.projects.map((p) => (
                <div key={p.id} className="li" style={{ cursor: "default" }}>
                  <Icon name="repo" style={{ color: "#92949D" }} />
                  <span className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}><span>{p.name}</span><span className="mono muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.path}>{p.path}</span></span>
                </div>
              ))}
              {!s.projects.length && <div className="caption" style={{ padding: "8px 12px" }}>No repositories yet.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
