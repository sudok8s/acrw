//! Tauri shell: exposes acrw-core to the React UI as `invoke` commands.
//! All work stays on this machine; nothing is sent over the network.

use acrw_core::{anyhow, db, engine, git, model::*, scan, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct AppState {
    db: engine::Db,
    work_root: PathBuf,
    db_path: PathBuf,
    cancels: Mutex<HashMap<i64, Arc<AtomicBool>>>,
}

type Res<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

fn with_db<T>(st: &AppState, f: impl FnOnce(&mut Connection) -> anyhow::Result<T>) -> Res<T> {
    let mut c = st
        .db
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    f(&mut c).map_err(e)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(e)?
}

/* ---------------- app ---------------- */

#[derive(Serialize)]
struct ScannerInfo {
    name: String,
    version: Option<String>,
    enabled: bool,
    profiles: Vec<String>,
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    db_path: String,
    work_root: String,
    scanners: Vec<ScannerInfo>,
}

#[tauri::command]
async fn app_info(state: State<'_, AppState>) -> Res<AppInfo> {
    let settings = with_db(&state, |c| db::get_settings(c))?;
    let (db_path, work_root) = (state.db_path.clone(), state.work_root.clone());
    blocking(move || {
        let scanners = scan::SCANNERS
            .iter()
            .map(|n| ScannerInfo {
                name: n.to_string(),
                version: scan::version(n, &settings),
                enabled: match *n {
                    "Semgrep" => settings.semgrep_enabled,
                    "Trivy" => settings.trivy_enabled,
                    _ => settings.gitleaks_enabled,
                },
                profiles: scan::profiles(n).iter().map(|p| p.to_string()).collect(),
            })
            .collect();
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            db_path: db_path.to_string_lossy().into(),
            work_root: work_root.to_string_lossy().into(),
            scanners,
        })
    })
    .await
}

/* ---------------- projects ---------------- */

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Res<Vec<Project>> {
    with_db(&state, |c| db::list_projects(c))
}

#[tauri::command]
fn add_project(state: State<'_, AppState>, path: String) -> Res<Project> {
    with_db(&state, |c| db::add_project(c, &path))
}

#[tauri::command]
fn remove_project(state: State<'_, AppState>, id: i64) -> Res<()> {
    with_db(&state, |c| db::remove_project(c, id))
}

#[derive(Serialize)]
struct Branches {
    branches: Vec<String>,
    current: Option<String>,
    default_base: Option<String>,
}

#[tauri::command]
async fn list_branches(state: State<'_, AppState>, project_id: i64) -> Res<Branches> {
    let p = with_db(&state, |c| db::get_project(c, project_id))?;
    blocking(move || {
        Ok(Branches {
            branches: git::list_branches(&p.path).map_err(e)?,
            current: git::current_branch(&p.path),
            default_base: git::default_base(&p.path),
        })
    })
    .await
}

/* ---------------- reviews ---------------- */

#[tauri::command]
async fn open_review(
    state: State<'_, AppState>,
    project_id: i64,
    base: String,
    target: String,
) -> Res<Review> {
    let p = with_db(&state, |c| db::get_project(c, project_id))?;
    let (b, t) = (base.clone(), target.clone());
    blocking(move || {
        let repo = git::open(&p.path).map_err(e)?;
        git::compare_points(&repo, &b, &t).map_err(e)?;
        Ok(())
    })
    .await?;
    with_db(&state, |c| db::open_review(c, project_id, &base, &target))
}

#[derive(Serialize)]
struct ReviewSummary {
    review: Review,
    project_name: String,
    reviewed_count: usize,
    unresolved: usize,
}

#[tauri::command]
fn list_reviews(state: State<'_, AppState>) -> Res<Vec<ReviewSummary>> {
    with_db(&state, |c| {
        let projects: HashMap<i64, String> = db::list_projects(c)?
            .into_iter()
            .map(|p| (p.id, p.name))
            .collect();
        let mut out = vec![];
        for r in db::list_reviews(c)? {
            let reviewed_count = db::reviewed_files(c, r.id)?.len();
            let unresolved = db::list_findings(c, Some(r.project_id), Some(&r.target))?
                .iter()
                .filter(|f| is_unresolved(&f.status))
                .count();
            out.push(ReviewSummary {
                project_name: projects.get(&r.project_id).cloned().unwrap_or_default(),
                review: r,
                reviewed_count,
                unresolved,
            });
        }
        Ok(out)
    })
}

#[tauri::command]
fn set_review_status(state: State<'_, AppState>, review_id: i64, status: String) -> Res<()> {
    with_db(&state, |c| db::set_review_status(c, review_id, &status))
}

#[derive(Serialize)]
struct ReviewFile {
    #[serde(flatten)]
    file: ChangedFile,
    reviewed: bool,
}

#[tauri::command]
async fn review_files(state: State<'_, AppState>, review_id: i64) -> Res<Vec<ReviewFile>> {
    let (r, p, reviewed) = with_db(&state, |c| {
        let r = db::get_review(c, review_id)?;
        let p = db::get_project(c, r.project_id)?;
        let rv = db::reviewed_files(c, review_id)?;
        Ok((r, p, rv))
    })?;
    blocking(move || {
        let files = git::changed_files(&p.path, &r.base, &r.target).map_err(e)?;
        Ok(files
            .into_iter()
            .map(|f| ReviewFile {
                reviewed: reviewed.contains(&f.path),
                file: f,
            })
            .collect())
    })
    .await
}

#[tauri::command]
async fn file_diff(
    state: State<'_, AppState>,
    review_id: i64,
    path: String,
    old_path: Option<String>,
) -> Res<FileDiff> {
    let (r, p) = with_db(&state, |c| {
        let r = db::get_review(c, review_id)?;
        let p = db::get_project(c, r.project_id)?;
        Ok((r, p))
    })?;
    blocking(move || {
        git::file_diff(&p.path, &r.base, &r.target, &path, old_path.as_deref()).map_err(e)
    })
    .await
}

#[tauri::command]
async fn file_at(
    state: State<'_, AppState>,
    project_id: i64,
    rev: String,
    path: String,
) -> Res<Option<String>> {
    let p = with_db(&state, |c| db::get_project(c, project_id))?;
    blocking(move || git::file_at(&p.path, &rev, &path).map_err(e)).await
}

#[tauri::command]
fn set_file_reviewed(
    state: State<'_, AppState>,
    review_id: i64,
    path: String,
    reviewed: bool,
) -> Res<()> {
    with_db(&state, |c| {
        db::set_file_reviewed(c, review_id, &path, reviewed)
    })
}

/* ---------------- scans ---------------- */

#[tauri::command]
fn start_scan(
    state: State<'_, AppState>,
    project_id: i64,
    scanner: String,
    rev: String,
    profile: String,
    base: Option<String>,
) -> Res<ScanRun> {
    if !scan::SCANNERS.contains(&scanner.as_str()) {
        return Err(format!("unknown scanner {scanner}"));
    }
    let run = with_db(&state, |c| {
        db::create_run(c, project_id, &scanner, &rev, &profile)
    })?;
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .map_err(e)?
        .insert(run.id, cancel.clone());
    let dbh = state.db.clone();
    let work = state.work_root.clone();
    let req = engine::ScanRequest {
        run_id: run.id,
        base,
    };
    std::thread::spawn(move || engine::run_scan(&dbh, &req, &work, &cancel));
    Ok(run)
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>, run_id: i64) -> Res<()> {
    if let Some(flag) = state.cancels.lock().map_err(e)?.get(&run_id) {
        flag.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err("this scan is not running".into())
    }
}

#[tauri::command]
fn list_scans(state: State<'_, AppState>, project_id: Option<i64>) -> Res<Vec<ScanRun>> {
    with_db(&state, |c| db::list_runs(c, project_id, 200))
}

/* ---------------- findings ---------------- */

#[tauri::command]
fn list_findings(
    state: State<'_, AppState>,
    project_id: Option<i64>,
    rev: Option<String>,
) -> Res<Vec<Finding>> {
    with_db(&state, |c| db::list_findings(c, project_id, rev.as_deref()))
}

#[tauri::command]
fn set_finding_status(state: State<'_, AppState>, id: i64, status: String) -> Res<()> {
    with_db(&state, |c| db::set_finding_status(c, id, &status))
}

#[tauri::command]
fn list_notes(state: State<'_, AppState>, finding_id: i64) -> Res<Vec<Note>> {
    with_db(&state, |c| db::list_notes(c, finding_id))
}

#[tauri::command]
fn add_note(state: State<'_, AppState>, finding_id: i64, text: String) -> Res<Note> {
    with_db(&state, |c| db::add_note(c, finding_id, &text))
}

/* ---------------- settings ---------------- */

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Res<Settings> {
    with_db(&state, |c| db::get_settings(c))
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Res<()> {
    with_db(&state, |c| db::save_settings(c, &settings))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Apps started from Finder get a minimal PATH; add the usual
            // Homebrew and user locations so scanners are found on macOS.
            #[cfg(target_os = "macos")]
            {
                let home = std::env::var("HOME").unwrap_or_default();
                let extra = [
                    "/opt/homebrew/bin",
                    "/usr/local/bin",
                    &format!("{home}/.local/bin"),
                ]
                .join(":");
                let cur = std::env::var("PATH").unwrap_or_default();
                std::env::set_var("PATH", format!("{extra}:{cur}"));
            }
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("acrw.db");
            let conn = db::open(&db_path)?;
            db::fail_orphaned_runs(&conn)?;
            let work_root = dir.join("work");
            let _ = std::fs::remove_dir_all(work_root.join("worktrees"));
            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                work_root,
                db_path,
                cancels: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_projects,
            add_project,
            remove_project,
            list_branches,
            open_review,
            list_reviews,
            set_review_status,
            review_files,
            file_diff,
            file_at,
            set_file_reviewed,
            start_scan,
            cancel_scan,
            list_scans,
            list_findings,
            set_finding_status,
            list_notes,
            add_note,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running ACRW");
}
