import { useState } from "react";
import { Icon } from "../icons";
import { useStore } from "../store";
import { isTauri } from "../api";
import { Banner, Empty, fmtTime } from "../ui";

export function ProjectsScreen() {
  const s = useStore();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    try {
      const path = await s.api.pickFolder();
      if (!path) return;
      const p = await s.api.addProject(path);
      await s.reloadProjects();
      s.notify(`${p.name} added. Open a review from Overview or the Review workspace.`);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  };
  const remove = async (id: number) => {
    try { await s.api.removeProject(id); await s.reloadProjects(); setConfirm(null); s.notify("Project removed from ACRW. The repository on disk was not touched."); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); }
  };
  const lastScan = (id: number) => s.scans.find((r) => r.project_id === id);
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Projects</h1><span className="caption">{s.projects.length} local repositories</span><span className="spacer" />
        <button className="cw-btn" onClick={add} disabled={!isTauri}><Icon name="plus" />Add repository…</button>
      </div>
      {err && <div style={{ padding: "8px 16px" }}><Banner kind="danger" title="Could not add.">{err}</Banner></div>}
      <div className="tbl-box">
        {!s.projects.length ? <Empty title="No repositories yet" action={<button className="cw-btn cw-btn-primary" onClick={add} disabled={!isTauri}><Icon name="folder" />Add repository…</button>}>Point ACRW at a folder inside a Git work tree. It only reads from it.</Empty> : (
          <table className="cw-table">
            <colgroup><col style={{ width: 200 }} /><col /><col style={{ width: 170 }} /><col style={{ width: 130 }} /><col style={{ width: 230 }} /></colgroup>
            <thead><tr><th>Project</th><th>Local path</th><th>Last scan</th><th>Added</th><th /></tr></thead>
            <tbody>
              {s.projects.map((p) => (
                <tr key={p.id} aria-selected={s.review?.project_id === p.id}>
                  <td><span style={{ fontWeight: 500 }}>{p.name}</span></td>
                  <td className="cw-path" title={p.path}>{p.path}</td>
                  <td className="caption">{lastScan(p.id) ? `${lastScan(p.id)!.scanner} · ${fmtTime(lastScan(p.id)!.started_at)}` : "never"}</td>
                  <td className="caption">{fmtTime(p.created_at)}</td>
                  <td>
                    {confirm === p.id ? (
                      <span className="row"><button className="cw-btn cw-btn-sm cw-btn-danger" onClick={() => remove(p.id)}>Remove {p.name}</button><button className="cw-btn cw-btn-sm" onClick={() => setConfirm(null)}>Keep</button></span>
                    ) : (
                      <span className="row">
                        <button className="cw-btn cw-btn-sm" onClick={() => s.go("overview")}>Start review</button>
                        <button className="cw-btn cw-btn-sm cw-btn-ghost" onClick={() => setConfirm(p.id)} disabled={!isTauri}>Remove…</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="tfoot"><span className="caption">Removing a project deletes its reviews, findings and notes from ACRW's local database only.</span></div>
    </div>
  );
}
