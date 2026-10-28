import type {
  AppInfo, Branches, FileDiff, Finding, Note, Project, Review, ReviewFile, ReviewSummary, ScanRun, Settings,
} from "./types";

export interface Api {
  appInfo(): Promise<AppInfo>;
  listProjects(): Promise<Project[]>;
  addProject(path: string): Promise<Project>;
  removeProject(id: number): Promise<void>;
  pickFolder(): Promise<string | null>;
  listBranches(projectId: number): Promise<Branches>;
  openReview(projectId: number, base: string, target: string): Promise<Review>;
  listReviews(): Promise<ReviewSummary[]>;
  setReviewStatus(reviewId: number, status: string): Promise<void>;
  reviewFiles(reviewId: number): Promise<ReviewFile[]>;
  fileDiff(reviewId: number, path: string, oldPath: string | null): Promise<FileDiff>;
  fileAt(projectId: number, rev: string, path: string): Promise<string | null>;
  setFileReviewed(reviewId: number, path: string, reviewed: boolean): Promise<void>;
  startScan(projectId: number, scanner: string, rev: string, profile: string, base: string | null): Promise<ScanRun>;
  cancelScan(runId: number): Promise<void>;
  listScans(projectId: number | null): Promise<ScanRun[]>;
  listFindings(projectId: number | null, rev: string | null): Promise<Finding[]>;
  setFindingStatus(id: number, status: string): Promise<void>;
  listNotes(findingId: number): Promise<Note[]>;
  addNote(findingId: number, text: string): Promise<Note>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriApi(): Promise<Api> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-dialog");
  return {
    appInfo: () => invoke("app_info"),
    listProjects: () => invoke("list_projects"),
    addProject: (path) => invoke("add_project", { path }),
    removeProject: (id) => invoke("remove_project", { id }),
    pickFolder: async () => {
      const r = await open({ directory: true, multiple: false, title: "Open a Git repository" });
      return typeof r === "string" ? r : null;
    },
    listBranches: (projectId) => invoke("list_branches", { projectId }),
    openReview: (projectId, base, target) => invoke("open_review", { projectId, base, target }),
    listReviews: () => invoke("list_reviews"),
    setReviewStatus: (reviewId, status) => invoke("set_review_status", { reviewId, status }),
    reviewFiles: (reviewId) => invoke("review_files", { reviewId }),
    fileDiff: (reviewId, path, oldPath) => invoke("file_diff", { reviewId, path, oldPath }),
    fileAt: (projectId, rev, path) => invoke("file_at", { projectId, rev, path }),
    setFileReviewed: (reviewId, path, reviewed) => invoke("set_file_reviewed", { reviewId, path, reviewed }),
    startScan: (projectId, scanner, rev, profile, base) => invoke("start_scan", { projectId, scanner, rev, profile, base }),
    cancelScan: (runId) => invoke("cancel_scan", { runId }),
    listScans: (projectId) => invoke("list_scans", { projectId }),
    listFindings: (projectId, rev) => invoke("list_findings", { projectId, rev }),
    setFindingStatus: (id, status) => invoke("set_finding_status", { id, status }),
    listNotes: (findingId) => invoke("list_notes", { findingId }),
    addNote: (findingId, text) => invoke("add_note", { findingId, text }),
    getSettings: () => invoke("get_settings"),
    saveSettings: (settings) => invoke("save_settings", { settings }),
  };
}

let instance: Promise<Api> | null = null;
/** Tauri backend in the desktop app; an in-memory demo backend in a plain browser. */
export function getApi(): Promise<Api> {
  if (!instance) instance = isTauri ? tauriApi() : import("./mock").then((m) => m.createMockApi());
  return instance;
}
