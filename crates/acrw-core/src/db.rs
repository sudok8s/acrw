//! SQLite persistence. Everything ACRW records lives in one local file.

use crate::model::*;
use anyhow::{Result, anyhow, bail};
use rusqlite::{Connection, OptionalExtension, Row, params};
use sha2::{Digest, Sha256};

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'In progress',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(project_id, base, target)
);
CREATE TABLE IF NOT EXISTS file_reviews (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, path TEXT NOT NULL,
  reviewed INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (review_id, path)
);
CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scanner TEXT NOT NULL, version TEXT, rev TEXT NOT NULL, commit_id TEXT, profile TEXT NOT NULL,
  status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, exit_code INTEGER,
  command TEXT NOT NULL DEFAULT '', log TEXT NOT NULL DEFAULT '', error TEXT,
  finding_count INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scan_run_id INTEGER NOT NULL, scanner TEXT NOT NULL, rule_id TEXT NOT NULL, title TEXT NOT NULL,
  message TEXT NOT NULL, severity TEXT NOT NULL, category TEXT NOT NULL, cwe TEXT NOT NULL,
  file TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, snippet TEXT NOT NULL,
  fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New', rev TEXT NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, trace TEXT,
  UNIQUE(project_id, rev, fingerprint)
);
CREATE INDEX IF NOT EXISTS findings_project ON findings(project_id, rev);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"#;

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/* ---------------- projects ---------------- */

fn project_row(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        path: r.get(2)?,
        created_at: r.get(3)?,
    })
}

pub fn add_project(c: &Connection, path: &str) -> Result<Project> {
    let root = crate::git::discover_root(path)?;
    if let Some(p) = c
        .query_row(
            "SELECT id,name,path,created_at FROM projects WHERE path=?1",
            [&root],
            project_row,
        )
        .optional()?
    {
        return Ok(p);
    }
    let name = std::path::Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());
    c.execute(
        "INSERT INTO projects(name,path,created_at) VALUES (?1,?2,?3)",
        params![name, root, now()],
    )?;
    get_project(c, c.last_insert_rowid())
}

pub fn get_project(c: &Connection, id: i64) -> Result<Project> {
    c.query_row(
        "SELECT id,name,path,created_at FROM projects WHERE id=?1",
        [id],
        project_row,
    )
    .optional()?
    .ok_or_else(|| anyhow!("project {id} not found"))
}

pub fn list_projects(c: &Connection) -> Result<Vec<Project>> {
    let mut st = c.prepare("SELECT id,name,path,created_at FROM projects ORDER BY name")?;
    let rows = st
        .query_map([], project_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn remove_project(c: &Connection, id: i64) -> Result<()> {
    c.execute("DELETE FROM projects WHERE id=?1", [id])?;
    Ok(())
}

/* ---------------- reviews ---------------- */

fn review_row(r: &Row) -> rusqlite::Result<Review> {
    Ok(Review {
        id: r.get(0)?,
        project_id: r.get(1)?,
        base: r.get(2)?,
        target: r.get(3)?,
        status: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}
const REVIEW_COLS: &str = "id,project_id,base,target,status,created_at,updated_at";

pub fn open_review(c: &Connection, project_id: i64, base: &str, target: &str) -> Result<Review> {
    let t = now();
    c.execute(
        "INSERT INTO reviews(project_id,base,target,status,created_at,updated_at) VALUES (?1,?2,?3,'In progress',?4,?4)
         ON CONFLICT(project_id,base,target) DO UPDATE SET updated_at=excluded.updated_at",
        params![project_id, base, target, t],
    )?;
    let r = c.query_row(
        &format!("SELECT {REVIEW_COLS} FROM reviews WHERE project_id=?1 AND base=?2 AND target=?3"),
        params![project_id, base, target],
        review_row,
    )?;
    Ok(r)
}

pub fn get_review(c: &Connection, id: i64) -> Result<Review> {
    c.query_row(
        &format!("SELECT {REVIEW_COLS} FROM reviews WHERE id=?1"),
        [id],
        review_row,
    )
    .optional()?
    .ok_or_else(|| anyhow!("review {id} not found"))
}

pub fn list_reviews(c: &Connection) -> Result<Vec<Review>> {
    let mut st = c.prepare(&format!(
        "SELECT {REVIEW_COLS} FROM reviews ORDER BY updated_at DESC"
    ))?;
    let rows = st
        .query_map([], review_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_review_status(c: &Connection, id: i64, status: &str) -> Result<()> {
    if !REVIEW_STATUSES.contains(&status) {
        bail!("unknown review status {status}");
    }
    c.execute(
        "UPDATE reviews SET status=?2, updated_at=?3 WHERE id=?1",
        params![id, status, now()],
    )?;
    Ok(())
}

pub fn reviewed_files(c: &Connection, review_id: i64) -> Result<Vec<String>> {
    let mut st = c.prepare("SELECT path FROM file_reviews WHERE review_id=?1 AND reviewed=1")?;
    let rows = st
        .query_map([review_id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(rows)
}

pub fn set_file_reviewed(c: &Connection, review_id: i64, path: &str, reviewed: bool) -> Result<()> {
    c.execute(
        "INSERT INTO file_reviews(review_id,path,reviewed,updated_at) VALUES (?1,?2,?3,?4)
         ON CONFLICT(review_id,path) DO UPDATE SET reviewed=excluded.reviewed, updated_at=excluded.updated_at",
        params![review_id, path, reviewed as i64, now()],
    )?;
    c.execute(
        "UPDATE reviews SET updated_at=?2 WHERE id=?1",
        params![review_id, now()],
    )?;
    Ok(())
}

/* ---------------- scan runs ---------------- */

fn run_row(r: &Row) -> rusqlite::Result<ScanRun> {
    Ok(ScanRun {
        id: r.get(0)?,
        project_id: r.get(1)?,
        scanner: r.get(2)?,
        version: r.get(3)?,
        rev: r.get(4)?,
        commit: r.get(5)?,
        profile: r.get(6)?,
        status: r.get(7)?,
        started_at: r.get(8)?,
        finished_at: r.get(9)?,
        exit_code: r.get(10)?,
        command: r.get(11)?,
        log: r.get(12)?,
        error: r.get(13)?,
        finding_count: r.get(14)?,
        new_count: r.get(15)?,
    })
}
const RUN_COLS: &str = "id,project_id,scanner,version,rev,commit_id,profile,status,started_at,finished_at,exit_code,command,log,error,finding_count,new_count";

pub fn create_run(
    c: &Connection,
    project_id: i64,
    scanner: &str,
    rev: &str,
    profile: &str,
) -> Result<ScanRun> {
    c.execute(
        "INSERT INTO scan_runs(project_id,scanner,rev,profile,status,started_at) VALUES (?1,?2,?3,?4,'queued',?5)",
        params![project_id, scanner, rev, profile, now()],
    )?;
    get_run(c, c.last_insert_rowid())
}

pub fn get_run(c: &Connection, id: i64) -> Result<ScanRun> {
    c.query_row(
        &format!("SELECT {RUN_COLS} FROM scan_runs WHERE id=?1"),
        [id],
        run_row,
    )
    .optional()?
    .ok_or_else(|| anyhow!("scan run {id} not found"))
}

pub fn list_runs(c: &Connection, project_id: Option<i64>, limit: i64) -> Result<Vec<ScanRun>> {
    let mut st = c.prepare(&format!(
        "SELECT {RUN_COLS} FROM scan_runs WHERE (?1 IS NULL OR project_id=?1) ORDER BY id DESC LIMIT ?2"
    ))?;
    let rows = st
        .query_map(params![project_id, limit], run_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn mark_run_started(
    c: &Connection,
    id: i64,
    version: Option<&str>,
    commit: &str,
    command: &str,
) -> Result<()> {
    c.execute(
        "UPDATE scan_runs SET status='running', version=?2, commit_id=?3, command=?4 WHERE id=?1",
        params![id, version, commit, command],
    )?;
    Ok(())
}

pub fn append_run_log(c: &Connection, id: i64, line: &str) -> Result<()> {
    c.execute(
        "UPDATE scan_runs SET log = log || ?2 || char(10) WHERE id=?1",
        params![id, line],
    )?;
    Ok(())
}

pub fn finish_run(
    c: &Connection,
    id: i64,
    status: &str,
    exit_code: Option<i32>,
    error: Option<&str>,
    finding_count: i64,
    new_count: i64,
) -> Result<()> {
    c.execute(
        "UPDATE scan_runs SET status=?2, exit_code=?3, error=?4, finished_at=?5, finding_count=?6, new_count=?7 WHERE id=?1",
        params![id, status, exit_code, error, now(), finding_count, new_count],
    )?;
    Ok(())
}

/// Runs left as queued/running by a previous session can never finish.
pub fn fail_orphaned_runs(c: &Connection) -> Result<()> {
    c.execute(
        "UPDATE scan_runs SET status='failed', error='ACRW was closed while this scan was running.', finished_at=?1
         WHERE status IN ('queued','running')",
        [now()],
    )?;
    Ok(())
}

/* ---------------- findings ---------------- */

pub fn fingerprint(f: &RawFinding) -> String {
    let mut h = Sha256::new();
    let anchor = if f.snippet.trim().is_empty() {
        f.line.to_string()
    } else {
        f.snippet.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    for part in [
        f.scanner.as_str(),
        f.rule_id.as_str(),
        f.file.as_str(),
        anchor.as_str(),
    ] {
        h.update(part.as_bytes());
        h.update([0u8]);
    }
    hex::encode(&h.finalize()[..12])
}

/// Inserts new findings and refreshes known ones (status and notes are kept).
/// Returns (total, newly inserted).
pub fn upsert_findings(
    c: &mut Connection,
    project_id: i64,
    run_id: i64,
    rev: &str,
    raws: &[RawFinding],
) -> Result<(i64, i64)> {
    let tx = c.transaction()?;
    let t = now();
    let mut new = 0;
    let mut seen = std::collections::HashSet::new();
    for f in raws {
        let fp = fingerprint(f);
        if !seen.insert(fp.clone()) {
            continue;
        }
        let trace = f.trace.as_ref().map(serde_json::to_string).transpose()?;
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM findings WHERE project_id=?1 AND rev=?2 AND fingerprint=?3",
                params![project_id, rev, fp],
                |r| r.get(0),
            )
            .optional()?;
        match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE findings SET scan_run_id=?2, line=?3, end_line=?4, message=?5, severity=?6, snippet=?7, last_seen=?8, trace=?9 WHERE id=?1",
                    params![id, run_id, f.line, f.end_line, f.message, f.severity, f.snippet, t, trace],
                )?;
            }
            None => {
                tx.execute(
                    "INSERT INTO findings(project_id,scan_run_id,scanner,rule_id,title,message,severity,category,cwe,file,line,end_line,snippet,fingerprint,status,rev,first_seen,last_seen,trace)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'New',?15,?16,?16,?17)",
                    params![project_id, run_id, f.scanner, f.rule_id, f.title, f.message, f.severity, f.category, f.cwe, f.file, f.line, f.end_line, f.snippet, fp, rev, t, trace],
                )?;
                new += 1;
            }
        }
    }
    tx.commit()?;
    Ok((seen.len() as i64, new))
}

fn finding_row(r: &Row) -> rusqlite::Result<Finding> {
    let trace: Option<String> = r.get(18)?;
    Ok(Finding {
        id: r.get(0)?,
        project_id: r.get(1)?,
        scan_run_id: r.get(2)?,
        scanner: r.get(3)?,
        rule_id: r.get(4)?,
        title: r.get(5)?,
        message: r.get(6)?,
        severity: r.get(7)?,
        category: r.get(8)?,
        cwe: r.get(9)?,
        file: r.get(10)?,
        line: r.get(11)?,
        end_line: r.get(12)?,
        snippet: r.get(13)?,
        fingerprint: r.get(14)?,
        status: r.get(15)?,
        rev: r.get(16)?,
        first_seen: r.get(17)?,
        last_seen: r.get(19)?,
        trace: trace.and_then(|t| serde_json::from_str(&t).ok()),
        note_count: r.get(20)?,
    })
}
const FINDING_SELECT: &str = "SELECT f.id,f.project_id,f.scan_run_id,f.scanner,f.rule_id,f.title,f.message,f.severity,f.category,f.cwe,f.file,f.line,f.end_line,f.snippet,f.fingerprint,f.status,f.rev,f.first_seen,f.trace,f.last_seen,(SELECT COUNT(*) FROM notes n WHERE n.finding_id=f.id) FROM findings f";

pub fn list_findings(
    c: &Connection,
    project_id: Option<i64>,
    rev: Option<&str>,
) -> Result<Vec<Finding>> {
    let mut st = c.prepare(&format!(
        "{FINDING_SELECT} WHERE (?1 IS NULL OR f.project_id=?1) AND (?2 IS NULL OR f.rev=?2) ORDER BY f.id"
    ))?;
    let rows = st
        .query_map(params![project_id, rev], finding_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_finding(c: &Connection, id: i64) -> Result<Finding> {
    c.query_row(
        &format!("{FINDING_SELECT} WHERE f.id=?1"),
        [id],
        finding_row,
    )
    .optional()?
    .ok_or_else(|| anyhow!("finding {id} not found"))
}

pub fn set_finding_status(c: &Connection, id: i64, status: &str) -> Result<()> {
    if !FINDING_STATUSES.contains(&status) {
        bail!("unknown finding status {status}");
    }
    c.execute(
        "UPDATE findings SET status=?2 WHERE id=?1",
        params![id, status],
    )?;
    Ok(())
}

pub fn add_note(c: &Connection, finding_id: i64, text: &str) -> Result<Note> {
    let text = text.trim();
    if text.is_empty() {
        bail!("note is empty");
    }
    c.execute(
        "INSERT INTO notes(finding_id,text,created_at) VALUES (?1,?2,?3)",
        params![finding_id, text, now()],
    )?;
    let id = c.last_insert_rowid();
    Ok(Note {
        id,
        finding_id,
        text: text.into(),
        created_at: now(),
    })
}

pub fn list_notes(c: &Connection, finding_id: i64) -> Result<Vec<Note>> {
    let mut st = c.prepare(
        "SELECT id,finding_id,text,created_at FROM notes WHERE finding_id=?1 ORDER BY id",
    )?;
    let rows = st
        .query_map([finding_id], |r| {
            Ok(Note {
                id: r.get(0)?,
                finding_id: r.get(1)?,
                text: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/* ---------------- settings ---------------- */

pub fn get_settings(c: &Connection) -> Result<Settings> {
    let v: Option<String> = c
        .query_row("SELECT value FROM settings WHERE key='app'", [], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(match v {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => Settings::default(),
    })
}

pub fn save_settings(c: &Connection, s: &Settings) -> Result<()> {
    c.execute(
        "INSERT INTO settings(key,value) VALUES ('app',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [serde_json::to_string(s)?],
    )?;
    Ok(())
}
