//! Builds the browser demo dataset used by `ui/src/mock.ts` from a real run
//! against the demo repository (scripts/make-demo-repo.sh).
//! Usage: cargo run -p acrw-core --example export_demo -- <repo> <out.json>

use acrw_core::{db, engine, git, scan};
use serde_json::json;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

const TRIVY_FIXTURE: &str = r#"{"Results":[{"Target":"requirements.txt","Vulnerabilities":[
 {"VulnerabilityID":"CVE-2024-24762","PkgName":"python-multipart","InstalledVersion":"0.0.6","FixedVersion":"0.0.7","Severity":"HIGH","Title":"Regular expression denial of service in Content-Type parsing","PrimaryURL":"https://avd.aquasec.com/nvd/cve-2024-24762","CweIDs":["CWE-1333"]}]}]}"#;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let repo = &args[1];
    let out = &args[2];
    let (base, target) = ("main", "feature/payment-validation");
    let tmp = std::env::temp_dir().join("acrw-demo-export");
    let _ = std::fs::remove_dir_all(&tmp);
    let c = db::open_in_memory()?;
    let p = db::add_project(&c, repo)?;
    let mut runs = vec![];
    for (scanner, profile) in [
        ("Semgrep", "Configured rules"),
        ("Gitleaks", "Working tree"),
    ] {
        let run = db::create_run(&c, p.id, scanner, target, profile)?;
        runs.push(run.id);
    }
    let dbh: engine::Db = Arc::new(Mutex::new(c));
    for id in &runs {
        engine::run_scan(
            &dbh,
            &engine::ScanRequest {
                run_id: *id,
                base: Some(base.into()),
            },
            &tmp,
            &AtomicBool::new(false),
        );
    }
    let mut guard = dbh.lock().unwrap();
    // Trivy cannot reach its DB in every environment; the demo uses a parsed fixture.
    let trivy_run = db::create_run(&guard, p.id, "Trivy", target, "Dependencies")?;
    let co = git::Checkout::create(repo, target, &tmp.join("wt"))?;
    let tv = scan::parse_trivy(TRIVY_FIXTURE, &co.dir)?;
    db::mark_run_started(
        &guard,
        trivy_run.id,
        Some("0.56.2"),
        &co.commit,
        "trivy fs --scanners vuln --format json .",
    )?;
    db::append_run_log(
        &guard,
        trivy_run.id,
        "demo dataset: parsed from a recorded Trivy report",
    )?;
    let (t, n) = db::upsert_findings(&mut guard, p.id, trivy_run.id, target, &tv)?;
    db::finish_run(&guard, trivy_run.id, "completed", Some(0), None, t, n)?;
    drop(co);

    let files = git::changed_files(repo, base, target)?;
    let diffs: Vec<_> = files
        .iter()
        .map(|f| git::file_diff(repo, base, target, &f.path, f.old_path.as_deref()))
        .collect::<anyhow::Result<_>>()?;
    let findings = db::list_findings(&guard, Some(p.id), None)?;
    let scans = db::list_runs(&guard, Some(p.id), 50)?;
    let data = json!({ "base": base, "target": target, "branches": git::list_branches(repo)?, "files": files, "diffs": diffs, "findings": findings, "scans": scans });
    std::fs::write(out, serde_json::to_string_pretty(&data)?)?;
    eprintln!(
        "wrote {out}: {} files, {} findings, {} scans",
        files.len(),
        findings.len(),
        scans.len()
    );
    Ok(())
}
