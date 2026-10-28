//! Plain data types shared by the core, the Tauri layer and (via serde) the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Review {
    pub id: i64,
    pub project_id: i64,
    pub base: String,
    pub target: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub const REVIEW_STATUSES: &[&str] = &[
    "Not started",
    "In progress",
    "Changes requested",
    "Approved",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    /// "A" added, "M" modified, "D" deleted, "R" renamed
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub binary: bool,
    /// Content at the merge base (None when added).
    pub original: Option<String>,
    /// Content at the target (None when deleted).
    pub modified: Option<String>,
    pub language: String,
    pub base_commit: String,
    pub target_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScanRun {
    pub id: i64,
    pub project_id: i64,
    pub scanner: String,
    pub version: Option<String>,
    pub rev: String,
    pub commit: Option<String>,
    pub profile: String,
    /// queued | running | completed | failed | cancelled
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub command: String,
    pub log: String,
    pub error: Option<String>,
    pub finding_count: i64,
    pub new_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraceNode {
    pub file: String,
    pub line: u32,
    pub content: String,
}

/// A source → sink path reported by the scanner (Semgrep taint mode).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Trace {
    pub source: Option<TraceNode>,
    pub steps: Vec<TraceNode>,
    pub sink: Option<TraceNode>,
}

/// What a scanner parser produces before it is stored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawFinding {
    pub scanner: String,
    pub rule_id: String,
    pub title: String,
    pub message: String,
    /// critical | high | medium | low | info
    pub severity: String,
    pub category: String,
    pub cwe: String,
    pub file: String,
    pub line: u32,
    pub end_line: u32,
    pub snippet: String,
    pub trace: Option<Trace>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Finding {
    pub id: i64,
    pub project_id: i64,
    pub scan_run_id: i64,
    pub scanner: String,
    pub rule_id: String,
    pub title: String,
    pub message: String,
    pub severity: String,
    pub category: String,
    pub cwe: String,
    pub file: String,
    pub line: u32,
    pub end_line: u32,
    pub snippet: String,
    pub fingerprint: String,
    pub status: String,
    pub rev: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub trace: Option<Trace>,
    pub note_count: i64,
}

pub const FINDING_STATUSES: &[&str] = &[
    "New",
    "Needs investigation",
    "Confirmed",
    "False positive",
    "Accepted risk",
    "Fixed",
    "Reviewed — no issue",
];

pub fn is_unresolved(status: &str) -> bool {
    matches!(status, "New" | "Needs investigation" | "Confirmed")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub id: i64,
    pub finding_id: i64,
    pub text: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub semgrep_bin: String,
    pub semgrep_configs: Vec<String>,
    pub trivy_bin: String,
    pub trivy_min_severity: String,
    /// Optional mirror for the Trivy vulnerability DB (e.g. an internal registry).
    pub trivy_db_repository: String,
    pub gitleaks_bin: String,
    pub semgrep_enabled: bool,
    pub trivy_enabled: bool,
    pub gitleaks_enabled: bool,
    pub default_diff_mode: String,
    pub inline_findings: bool,
    pub density: String,
    pub code_font_size: f32,
    pub sidebar_compact: bool,
    pub ai_enabled: bool,
    pub ai_provider: String,
    pub ai_endpoint: String,
    pub ai_redaction: bool,
    pub keep_scan_artifacts_days: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            semgrep_bin: "semgrep".into(),
            semgrep_configs: vec!["bundled:acrw-python".into()],
            trivy_bin: "trivy".into(),
            trivy_min_severity: "LOW".into(),
            trivy_db_repository: String::new(),
            gitleaks_bin: "gitleaks".into(),
            semgrep_enabled: true,
            trivy_enabled: true,
            gitleaks_enabled: true,
            default_diff_mode: "unified".into(),
            inline_findings: true,
            density: "compact".into(),
            code_font_size: 12.5,
            sidebar_compact: false,
            ai_enabled: false,
            ai_provider: "local".into(),
            ai_endpoint: "http://127.0.0.1:11434".into(),
            ai_redaction: true,
            keep_scan_artifacts_days: 30,
        }
    }
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
