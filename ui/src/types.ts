// Mirrors acrw-core model types (serde field names).

export interface Project { id: number; name: string; path: string; created_at: number }
export interface Review { id: number; project_id: number; base: string; target: string; status: string; created_at: number; updated_at: number }
export interface ReviewSummary { review: Review; project_name: string; reviewed_count: number; unresolved: number }
export interface ChangedFile { path: string; old_path: string | null; status: "A" | "M" | "D" | "R"; additions: number; deletions: number; binary: boolean }
export interface ReviewFile extends ChangedFile { reviewed: boolean }
export interface FileDiff {
  path: string; old_path: string | null; status: string; binary: boolean;
  original: string | null; modified: string | null; language: string; base_commit: string; target_commit: string;
}
export interface ScanRun {
  id: number; project_id: number; scanner: string; version: string | null; rev: string; commit: string | null; profile: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled"; started_at: number; finished_at: number | null;
  exit_code: number | null; command: string; log: string; error: string | null; finding_count: number; new_count: number;
}
export interface TraceNode { file: string; line: number; content: string }
export interface Trace { source: TraceNode | null; steps: TraceNode[]; sink: TraceNode | null }
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export interface Finding {
  id: number; project_id: number; scan_run_id: number; scanner: string; rule_id: string; title: string; message: string;
  severity: Severity; category: string; cwe: string; file: string; line: number; end_line: number; snippet: string;
  fingerprint: string; status: string; rev: string; first_seen: number; last_seen: number; trace: Trace | null; note_count: number;
}
export interface Note { id: number; finding_id: number; text: string; created_at: number }
export interface Settings {
  semgrep_bin: string; semgrep_configs: string[]; trivy_bin: string; trivy_min_severity: string; trivy_db_repository: string;
  gitleaks_bin: string; semgrep_enabled: boolean; trivy_enabled: boolean; gitleaks_enabled: boolean;
  default_diff_mode: "unified" | "split"; inline_findings: boolean; density: "compact" | "comfortable"; code_font_size: number;
  sidebar_compact: boolean; ai_enabled: boolean; ai_provider: "local" | "external"; ai_endpoint: string; ai_redaction: boolean;
  keep_scan_artifacts_days: number;
}
export interface ScannerInfo { name: string; version: string | null; enabled: boolean; profiles: string[] }
export interface AppInfo { version: string; db_path: string; work_root: string; scanners: ScannerInfo[] }
export interface Branches { branches: string[]; current: string | null; default_base: string | null }

export const FINDING_STATUSES = [
  "New", "Needs investigation", "Confirmed", "False positive", "Accepted risk", "Fixed", "Reviewed — no issue",
] as const;
export const REVIEW_STATUSES = ["Not started", "In progress", "Changes requested", "Approved"] as const;
export const isUnresolved = (s: string) => s === "New" || s === "Needs investigation" || s === "Confirmed";
export const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Informational" };
