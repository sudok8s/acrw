//! Seeds an ACRW database with a project, a review and real scans — handy for
//! trying the desktop app quickly. Usage:
//!   cargo run -p acrw-core --example seed_db -- <acrw.db> <repo> <base> <target>
use acrw_core::{db, engine};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

fn main() -> anyhow::Result<()> {
    let a: Vec<String> = std::env::args().collect();
    let (db_path, repo, base, target) = (&a[1], &a[2], &a[3], &a[4]);
    let c = db::open(std::path::Path::new(db_path))?;
    let p = db::add_project(&c, repo)?;
    db::open_review(&c, p.id, base, target)?;
    let ids: Vec<i64> = [
        ("Semgrep", "Configured rules"),
        ("Gitleaks", "Working tree"),
    ]
    .iter()
    .map(|(s, pr)| db::create_run(&c, p.id, s, target, pr).map(|r| r.id))
    .collect::<anyhow::Result<_>>()?;
    let dbh: engine::Db = Arc::new(Mutex::new(c));
    let work = std::env::temp_dir().join("acrw-seed");
    for id in ids {
        engine::run_scan(
            &dbh,
            &engine::ScanRequest {
                run_id: id,
                base: Some(base.clone()),
            },
            &work,
            &AtomicBool::new(false),
        );
        let r = db::get_run(&dbh.lock().unwrap(), id)?;
        eprintln!(
            "{} #{}: {} ({} findings)",
            r.scanner, r.id, r.status, r.finding_count
        );
    }
    Ok(())
}
