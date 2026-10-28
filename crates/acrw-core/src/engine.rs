//! Executes one scan run end to end: checkout → scanner → parse → store.

use crate::{db, git, scan};
use anyhow::Result;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

pub struct ScanRequest {
    pub run_id: i64,
    /// Merge-base side of the review; used by the Gitleaks history profile.
    pub base: Option<String>,
}

fn log(dbh: &Db, run: i64, line: &str) {
    if let Ok(c) = dbh.lock() {
        let _ = db::append_run_log(&c, run, line);
    }
}

fn fail(dbh: &Db, run: i64, msg: &str) {
    log(dbh, run, &format!("ERR {msg}"));
    if let Ok(c) = dbh.lock() {
        let _ = db::finish_run(&c, run, "failed", None, Some(msg), 0, 0);
    }
}

/// Blocking: call from a worker thread.
pub fn run_scan(dbh: &Db, req: &ScanRequest, work_root: &Path, cancel: &AtomicBool) {
    if let Err(e) = run_scan_inner(dbh, req, work_root, cancel) {
        fail(dbh, req.run_id, &format!("{e:#}"));
    }
}

fn run_scan_inner(
    dbh: &Db,
    req: &ScanRequest,
    work_root: &Path,
    cancel: &AtomicBool,
) -> Result<()> {
    let (run, project, settings) = {
        let c = dbh
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let run = db::get_run(&c, req.run_id)?;
        let project = db::get_project(&c, run.project_id)?;
        (run, project, db::get_settings(&c)?)
    };
    let id = run.id;
    let version = scan::version(&run.scanner, &settings);
    if version.is_none() {
        anyhow::bail!(
            "{} was not found. Install it or set its path in Settings › Scanners.",
            run.scanner
        );
    }
    let work: PathBuf = work_root.join(format!("run-{id}"));
    std::fs::create_dir_all(&work)?;

    let history = run.profile.starts_with("Git history");
    let mut checkout = None;
    let mut gl_history = None;
    let commit;
    if history {
        let repo = git::open(&project.path)?;
        let base = req
            .base
            .clone()
            .or_else(|| git::default_base(&project.path))
            .unwrap_or_else(|| "main".into());
        let (mb, t) = git::compare_points(&repo, &base, &run.rev)?;
        commit = git::short(t);
        gl_history = Some(scan::GitleaksHistory {
            repo: PathBuf::from(&project.path),
            range: format!("{mb}..{t}"),
        });
        log(
            dbh,
            id,
            &format!(
                "history range {}..{} ({base}...{})",
                git::short(mb),
                commit,
                run.rev
            ),
        );
    } else {
        log(
            dbh,
            id,
            &format!("checking out {} into a temporary worktree", run.rev),
        );
        let co = git::Checkout::create(&project.path, &run.rev, &work_root.join("worktrees"))?;
        commit = co.commit.clone();
        checkout = Some(co);
    }
    let scan_dir: PathBuf = checkout
        .as_ref()
        .map(|c| c.dir.clone())
        .unwrap_or_else(|| PathBuf::from(&project.path));
    let inv = scan::invocation(
        &run.scanner,
        &settings,
        &scan_dir,
        &work,
        version.as_deref(),
        gl_history.as_ref(),
    )?;
    {
        let c = dbh
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        db::mark_run_started(&c, id, version.as_deref(), &commit, &inv.display())?;
    }
    log(
        dbh,
        id,
        &format!(
            "{} {} on {}@{}",
            run.scanner,
            version.as_deref().unwrap_or("?"),
            run.rev,
            commit
        ),
    );

    let outcome = scan::execute(&inv, cancel, |l| log(dbh, id, l))?;
    if outcome.cancelled {
        log(dbh, id, "cancelled — partial results discarded");
        let c = dbh
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        db::finish_run(&c, id, "cancelled", None, None, 0, 0)?;
        return Ok(());
    }
    let code = outcome.exit_code;
    let ok_code = match run.scanner.as_str() {
        "Semgrep" => matches!(code, Some(0) | Some(1)),
        _ => code == Some(0),
    };
    let local_ids =
        scan::local_rule_ids(&scan::semgrep_configs(&settings, &work).unwrap_or_default());
    let parsed = scan::collect(&run.scanner, &inv, &scan_dir, &local_ids);
    let parsed = match parsed {
        Ok(p) => p,
        Err(e) => {
            let msg = format!(
                "{} exited with code {} and no usable report: {e:#}",
                run.scanner,
                code.map(|c| c.to_string()).unwrap_or("?".into())
            );
            fail(dbh, id, &msg);
            return Ok(());
        }
    };
    if !ok_code && parsed.findings.is_empty() {
        let msg = format!(
            "{} exited with code {}. See the log for details.",
            run.scanner,
            code.map(|c| c.to_string()).unwrap_or("?".into())
        );
        fail(dbh, id, &msg);
        return Ok(());
    }
    for w in &parsed.warnings {
        log(dbh, id, &format!("warning: {w}"));
    }
    let mut c = dbh
        .lock()
        .map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
    let (total, new) = db::upsert_findings(&mut c, run.project_id, id, &run.rev, &parsed.findings)?;
    db::append_run_log(&c, id, &format!("{total} findings ({new} new)"))?;
    db::finish_run(&c, id, "completed", code, None, total, new)?;
    drop(c);
    drop(checkout);
    let _ = std::fs::remove_dir_all(work.join("rules"));
    Ok(())
}
