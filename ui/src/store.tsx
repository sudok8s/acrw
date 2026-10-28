// Application state: one provider shared by every screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getApi, type Api } from "./api";
import type { AppInfo, Finding, Project, Review, ReviewFile, ScanRun, Settings } from "./types";

export type Screen = "overview" | "projects" | "review" | "flow" | "findings" | "scans" | "settings";

export interface FindingsPreset { scanner?: string; scope?: "all" | "review" | "other"; status?: string; selId?: number | null; nonce: number }

interface Store {
  api: Api;
  info: AppInfo | null;
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => void;
  screen: Screen;
  go: (s: Screen) => void;
  projects: Project[];
  reloadProjects: () => Promise<Project[]>;
  project: Project | null;
  review: Review | null;
  openReview: (projectId: number, base: string, target: string) => Promise<boolean>;
  setReviewStatus: (s: string) => void;
  files: ReviewFile[] | null;
  filesError: string | null;
  setFileReviewed: (path: string, v: boolean) => void;
  selPath: string | null;
  focus: { line: number | null; nonce: number };
  openFile: (path: string, line?: number | null) => void;
  findings: Finding[];
  reloadFindings: () => Promise<void>;
  setFindingStatus: (id: number, status: string) => void;
  selFindingId: number | null;
  selectFinding: (id: number, navigate?: boolean) => void;
  scans: ScanRun[];
  startScan: (scanner: string, rev: string, profile: string) => Promise<ScanRun | null>;
  cancelScan: (id: number) => void;
  flowFindingId: number | null;
  openFlow: (findingId: number | null) => void;
  findingsPreset: FindingsPreset;
  showFindings: (p: Omit<FindingsPreset, "nonce">) => void;
  scanSelId: number | null;
  showScan: (id: number | null, openStart?: boolean) => void;
  startOpenNonce: number;
  toast: string | null;
  notify: (msg: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  reviewFindings: Finding[];
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("store missing");
  return s;
};

const LAST_REVIEW_KEY = "acrw.lastReview";

export function StoreProvider({ api, children }: { api: Api; children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [screen, setScreen] = useState<Screen>("review");
  const [projects, setProjects] = useState<Project[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selPath, setSelPath] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ line: number | null; nonce: number }>({ line: null, nonce: 0 });
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selFindingId, setSelFindingId] = useState<number | null>(null);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [flowFindingId, setFlowFindingId] = useState<number | null>(null);
  const [findingsPreset, setFindingsPreset] = useState<FindingsPreset>({ nonce: 0 });
  const [scanSelId, setScanSelId] = useState<number | null>(null);
  const [startOpenNonce, setStartOpenNonce] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toastT = useRef<number>();

  const notify = useCallback((msg: string) => {
    window.clearTimeout(toastT.current);
    setToast(msg);
    toastT.current = window.setTimeout(() => setToast(null), 4200);
  }, []);
  const fail = useCallback((e: unknown) => notify(String((e as Error)?.message ?? e)), [notify]);

  const project = useMemo(() => projects.find((p) => p.id === review?.project_id) ?? null, [projects, review]);

  const reloadProjects = useCallback(async () => {
    const p = await api.listProjects();
    setProjects(p);
    return p;
  }, [api]);

  const reloadFindings = useCallback(async () => {
    if (!review) { setFindings([]); return; }
    try { setFindings(await api.listFindings(review.project_id, null)); } catch (e) { fail(e); }
  }, [api, review, fail]);

  const loadFiles = useCallback(async (r: Review) => {
    setFiles(null);
    setFilesError(null);
    try {
      const f = await api.reviewFiles(r.id);
      setFiles(f);
      setSelPath((cur) => (cur && f.some((x) => x.path === cur) ? cur : f[0]?.path ?? null));
    } catch (e) {
      setFilesError(String((e as Error)?.message ?? e));
      setFiles([]);
    }
  }, [api]);

  const openReview = useCallback(async (projectId: number, base: string, target: string) => {
    try {
      const r = await api.openReview(projectId, base, target);
      setReview(r);
      setSelPath(null);
      setSelFindingId(null);
      localStorage.setItem(LAST_REVIEW_KEY, JSON.stringify({ projectId, base, target }));
      await loadFiles(r);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }, [api, loadFiles, fail]);

  // boot: info, settings, projects, last review
  useEffect(() => {
    (async () => {
      try {
        // Scanner version probing can be slow; never block start-up on it.
        api.appInfo().then(setInfo).catch(fail);
        const [s, p] = await Promise.all([api.getSettings(), api.listProjects()]);
        setSettings(s); setProjects(p);
        let last: { projectId: number; base: string; target: string } | null = null;
        try { last = JSON.parse(localStorage.getItem(LAST_REVIEW_KEY) ?? "null"); } catch { /* ignore */ }
        if (!last || !p.some((x) => x.id === last!.projectId)) {
          const reviews = await api.listReviews();
          const r = reviews.find((x) => p.some((pp) => pp.id === x.review.project_id));
          if (r) last = { projectId: r.review.project_id, base: r.review.base, target: r.review.target };
          else if (p[0]) {
            const b = await api.listBranches(p[0].id);
            const base = b.default_base ?? b.branches[0];
            const target = b.branches.find((x) => x !== base && !x.includes("/HEAD")) ?? base;
            if (base && target && base !== target) last = { projectId: p[0].id, base, target };
          }
        }
        if (last) await openReview(last.projectId, last.base, last.target);
      } catch (e) { fail(e); }
    })();
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reloadFindings(); }, [reloadFindings]);

  // scans: poll quickly while something runs
  const prevScans = useRef<ScanRun[]>([]);
  useEffect(() => {
    let alive = true;
    let t: number;
    const tick = async () => {
      try {
        const s = await api.listScans(null);
        if (!alive) return;
        const finished = s.filter((x) => {
          const before = prevScans.current.find((p) => p.id === x.id);
          return before && (before.status === "running" || before.status === "queued") && x.status !== before.status;
        });
        prevScans.current = s;
        setScans(s);
        if (finished.length) {
          reloadFindings();
          const f = finished[0];
          notify(f.status === "completed" ? `${f.scanner} run #${f.id} completed — ${f.finding_count} findings, ${f.new_count} new.` : `${f.scanner} run #${f.id} ${f.status}.`);
        }
        const active = s.some((x) => x.status === "running" || x.status === "queued");
        t = window.setTimeout(tick, active ? 1200 : 6000);
      } catch {
        t = window.setTimeout(tick, 6000);
      }
    };
    tick();
    return () => { alive = false; window.clearTimeout(t); };
  }, [api, reloadFindings, notify]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      api.saveSettings(next).catch(fail);
      return next;
    });
  }, [api, fail]);

  const reviewFindings = useMemo(() => {
    if (!review || !files) return [];
    const paths = new Set(files.map((f) => f.path));
    return findings.filter((f) => f.rev === review.target && paths.has(f.file));
  }, [findings, review, files]);

  const openFile = useCallback((path: string, line?: number | null) => {
    setScreen("review");
    setSelPath(path);
    setFocus((f) => ({ line: line ?? null, nonce: f.nonce + 1 }));
  }, []);

  const selectFinding = useCallback((id: number, navigate?: boolean) => {
    setSelFindingId(id);
    const f = findings.find((x) => x.id === id);
    if (f && (navigate || f.file === selPath) && reviewFindings.some((x) => x.id === id)) openFile(f.file, f.line);
  }, [findings, selPath, reviewFindings, openFile]);

  const value: Store = {
    api, info, settings, updateSettings, screen,
    go: (s) => { setScreen(s); setPaletteOpen(false); },
    projects, reloadProjects, project, review, openReview,
    setReviewStatus: (s) => {
      if (!review) return;
      api.setReviewStatus(review.id, s).then(() => { setReview({ ...review, status: s }); notify(`Review status set to ${s}.`); }).catch(fail);
    },
    files, filesError,
    setFileReviewed: (path, v) => {
      if (!review) return;
      setFiles((fs) => fs?.map((f) => (f.path === path ? { ...f, reviewed: v } : f)) ?? fs);
      api.setFileReviewed(review.id, path, v).catch(fail);
    },
    selPath, focus, openFile,
    findings, reloadFindings,
    setFindingStatus: (id, status) => {
      setFindings((fs) => fs.map((f) => (f.id === id ? { ...f, status } : f)));
      api.setFindingStatus(id, status).then(() => notify(`Finding #${id} set to ${status}.`)).catch(fail);
    },
    selFindingId, selectFinding,
    scans,
    startScan: async (scanner, rev, profile) => {
      if (!review) return null;
      try {
        const r = await api.startScan(review.project_id, scanner, rev, profile, review.base);
        setScans((s) => [r, ...s]);
        prevScans.current = [r, ...prevScans.current];
        setScanSelId(r.id);
        notify(`${scanner} run #${r.id} started on ${rev}. It runs locally in the background.`);
        return r;
      } catch (e) { fail(e); return null; }
    },
    cancelScan: (id) => api.cancelScan(id).then(() => notify(`Cancelling run #${id}…`)).catch(fail),
    flowFindingId,
    openFlow: (id) => { setFlowFindingId(id); setScreen("flow"); setPaletteOpen(false); },
    findingsPreset,
    showFindings: (p) => { setFindingsPreset({ ...p, nonce: findingsPreset.nonce + 1 }); setScreen("findings"); setPaletteOpen(false); },
    scanSelId,
    showScan: (id, openStart) => { if (id != null) setScanSelId(id); if (openStart) setStartOpenNonce((n) => n + 1); setScreen("scans"); setPaletteOpen(false); },
    startOpenNonce,
    toast, notify,
    paletteOpen, setPaletteOpen,
    reviewFindings,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApiReady() {
  const [api, setApi] = useState<Api | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getApi().then(setApi).catch((e) => setErr(String(e))); }, []);
  return { api, err };
}
