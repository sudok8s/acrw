// In-memory demo backend for running the UI in a plain browser (`npm run dev`).
// Its data was produced by acrw-core against scripts/make-demo-repo.sh
// (see crates/acrw-core/examples/export_demo.rs). Nothing here touches disk.
import type { Api } from "./api";
import demo from "./demo-data.json";
import type { ChangedFile, FileDiff, Finding, Note, Project, Review, ScanRun, Settings } from "./types";

const now = () => Math.floor(Date.now() / 1000);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function createMockApi(): Api {
  const project: Project = { id: 1, name: "payments-api (demo)", path: "~/demo/payments-api", created_at: now() };
  const projects: Project[] = [project];
  const reviews: Review[] = [];
  const reviewed = new Map<number, Set<string>>();
  const findings: Finding[] = clone(demo.findings as Finding[]).map((f) => ({ ...f, project_id: 1 }));
  const scans: ScanRun[] = clone(demo.scans as ScanRun[]).map((s) => ({ ...s, project_id: 1, command: s.command.replace(/\/tmp\/[^ ]*/g, "<work>") }));
  const notes: Note[] = [];
  let settings: Settings = {
    semgrep_bin: "semgrep", semgrep_configs: ["bundled:acrw-python"], trivy_bin: "trivy", trivy_min_severity: "LOW", trivy_db_repository: "",
    gitleaks_bin: "gitleaks", semgrep_enabled: true, trivy_enabled: true, gitleaks_enabled: true, default_diff_mode: "unified",
    inline_findings: true, density: "compact", code_font_size: 12.5, sidebar_compact: false, ai_enabled: false, ai_provider: "local",
    ai_endpoint: "http://127.0.0.1:11434", ai_redaction: true, keep_scan_artifacts_days: 30,
  };
  let seq = 100;
  const delay = <T,>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(clone(v)), ms));

  return {
    appInfo: () => delay({
      version: "0.1.0 · browser demo", db_path: "(in memory)", work_root: "(none)",
      scanners: [
        { name: "Semgrep", version: "demo", enabled: true, profiles: ["Configured rules"] },
        { name: "Trivy", version: "demo", enabled: true, profiles: ["Dependencies"] },
        { name: "Gitleaks", version: "demo", enabled: true, profiles: ["Working tree", "Git history since merge base"] },
      ],
    }),
    listProjects: () => delay(projects),
    addProject: async () => { throw new Error("The browser demo cannot open folders. Run the desktop app (npm run tauri dev)."); },
    removeProject: async () => { throw new Error("The demo project cannot be removed."); },
    pickFolder: async () => null,
    listBranches: () => delay({ branches: demo.branches, current: demo.branches[0], default_base: "main" }),
    openReview: async (projectId, base, target) => {
      if (base !== demo.base || target !== demo.target) throw new Error(`The browser demo only has ${demo.base}...${demo.target}.`);
      let r = reviews.find((x) => x.project_id === projectId && x.base === base && x.target === target);
      if (!r) { r = { id: reviews.length + 1, project_id: projectId, base, target, status: "In progress", created_at: now(), updated_at: now() }; reviews.push(r); }
      return delay(r);
    },
    listReviews: () => delay(reviews.map((r) => ({
      review: r, project_name: project.name, reviewed_count: reviewed.get(r.id)?.size ?? 0,
      unresolved: findings.filter((f) => f.rev === r.target && ["New", "Needs investigation", "Confirmed"].includes(f.status)).length,
    }))),
    setReviewStatus: async (id, status) => { const r = reviews.find((x) => x.id === id); if (r) { r.status = status; r.updated_at = now(); } },
    reviewFiles: (id) => delay((demo.files as unknown as ChangedFile[]).map((f) => ({ ...f, reviewed: reviewed.get(id)?.has(f.path) ?? false })), 220),
    fileDiff: (_id, path) => delay((demo.diffs as FileDiff[]).find((d) => d.path === path)!, 160),
    fileAt: async (_p, _rev, path) => (demo.diffs as FileDiff[]).find((d) => d.path === path)?.modified ?? null,
    setFileReviewed: async (id, path, v) => { const s = reviewed.get(id) ?? new Set(); v ? s.add(path) : s.delete(path); reviewed.set(id, s); },
    startScan: async (projectId, scanner, rev, profile) => {
      const run: ScanRun = { id: ++seq, project_id: projectId, scanner, version: "demo", rev, commit: "demo", profile, status: "running",
        started_at: now(), finished_at: null, exit_code: null, command: `${scanner.toLowerCase()} (simulated in the browser demo)`,
        log: "browser demo: no scanner process is started\n", error: null, finding_count: 0, new_count: 0 };
      scans.unshift(run);
      setTimeout(() => {
        if (run.status !== "running") return;
        run.status = "completed"; run.finished_at = now(); run.exit_code = 0;
        run.finding_count = findings.filter((f) => f.scanner === scanner).length;
        run.log += "done (simulated)\n";
      }, 4000);
      return clone(run);
    },
    cancelScan: async (id) => { const r = scans.find((s) => s.id === id); if (r && r.status === "running") { r.status = "cancelled"; r.finished_at = now(); r.log += "cancelled\n"; } },
    listScans: () => delay(scans, 30),
    listFindings: (_p, rev) => delay(findings.filter((f) => !rev || f.rev === rev).map((f) => ({ ...f, note_count: notes.filter((n) => n.finding_id === f.id).length }))),
    setFindingStatus: async (id, status) => { const f = findings.find((x) => x.id === id); if (f) f.status = status; },
    listNotes: (id) => delay(notes.filter((n) => n.finding_id === id)),
    addNote: async (finding_id, text) => { const n = { id: ++seq, finding_id, text: text.trim(), created_at: now() }; notes.push(n); return clone(n); },
    getSettings: () => delay(settings),
    saveSettings: async (s) => { settings = clone(s); },
  };
}
