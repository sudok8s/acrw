use acrw_core::{db, engine, git, model::*, scan};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

fn demo_repo(tmp: &Path) -> String {
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/make-demo-repo.sh");
    let dir = tmp.join("payments-api");
    let st = Command::new("bash")
        .arg(script)
        .arg(&dir)
        .output()
        .expect("bash");
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );
    dir.to_string_lossy().into_owned()
}

fn has(bin: &str) -> bool {
    Command::new(bin).arg("--help").output().is_ok()
}

#[test]
fn three_dot_changeset() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = demo_repo(tmp.path());
    let files = git::changed_files(&repo, "main", "feature/payment-validation").unwrap();
    let by: std::collections::HashMap<_, _> = files.iter().map(|f| (f.path.as_str(), f)).collect();
    assert_eq!(by["app/services/auth_service.py"].status, "R");
    assert_eq!(
        by["app/services/auth_service.py"].old_path.as_deref(),
        Some("app/services/auth.py")
    );
    assert_eq!(by["tests/test_payments.py"].status, "A");
    assert_eq!(by["app/db/queries.py"].status, "M");
    assert!(by["app/api/routes/payments.py"].additions > 5);

    let d = git::file_diff(
        &repo,
        "main",
        "feature/payment-validation",
        "app/db/queries.py",
        None,
    )
    .unwrap();
    assert!(d.original.unwrap().contains(":q"));
    assert!(d.modified.unwrap().contains("'%{q}%'"));
    assert_eq!(d.language, "python");

    let r = git::file_diff(
        &repo,
        "main",
        "feature/payment-validation",
        "app/services/auth_service.py",
        Some("app/services/auth.py"),
    )
    .unwrap();
    assert_eq!(r.status, "R");
    assert!(r.original.unwrap().contains("audience=\"payments-api\""));

    let branches = git::list_branches(&repo).unwrap();
    assert!(
        branches.contains(&"main".to_string())
            && branches.contains(&"feature/payment-validation".to_string())
    );
    assert_eq!(git::default_base(&repo).as_deref(), Some("main"));
}

#[test]
fn store_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = demo_repo(tmp.path());
    let mut c = db::open_in_memory().unwrap();
    let p = db::add_project(&c, &format!("{repo}/app")).unwrap();
    assert_eq!(p.name, "payments-api");
    assert_eq!(
        db::add_project(&c, &repo).unwrap().id,
        p.id,
        "same root is not added twice"
    );
    let r = db::open_review(&c, p.id, "main", "feature/payment-validation").unwrap();
    db::set_file_reviewed(&c, r.id, "requirements.txt", true).unwrap();
    assert_eq!(
        db::reviewed_files(&c, r.id).unwrap(),
        vec!["requirements.txt"]
    );
    db::set_review_status(&c, r.id, "Approved").unwrap();
    assert!(db::set_review_status(&c, r.id, "Bogus").is_err());

    let run = db::create_run(
        &c,
        p.id,
        "Semgrep",
        "feature/payment-validation",
        "Configured rules",
    )
    .unwrap();
    let raw = RawFinding {
        scanner: "Semgrep".into(),
        rule_id: "x".into(),
        title: "T".into(),
        message: "m".into(),
        severity: "high".into(),
        category: "Injection".into(),
        cwe: "CWE-89".into(),
        file: "a.py".into(),
        line: 3,
        end_line: 3,
        snippet: "q = 1".into(),
        trace: None,
    };
    let (t, n) = db::upsert_findings(
        &mut c,
        p.id,
        run.id,
        "feature/payment-validation",
        std::slice::from_ref(&raw),
    )
    .unwrap();
    assert_eq!((t, n), (1, 1));
    let f = &db::list_findings(&c, Some(p.id), None).unwrap()[0];
    db::set_finding_status(&c, f.id, "Confirmed").unwrap();
    db::add_note(&c, f.id, "checked the caller").unwrap();
    // same finding moved two lines down: status and notes survive
    let mut moved = raw.clone();
    moved.line = 5;
    let (_, n2) =
        db::upsert_findings(&mut c, p.id, run.id, "feature/payment-validation", &[moved]).unwrap();
    assert_eq!(n2, 0);
    let f2 = db::get_finding(&c, f.id).unwrap();
    assert_eq!(
        (f2.status.as_str(), f2.line, f2.note_count),
        ("Confirmed", 5, 1)
    );

    let mut s = db::get_settings(&c).unwrap();
    s.ai_enabled = true;
    db::save_settings(&c, &s).unwrap();
    assert!(db::get_settings(&c).unwrap().ai_enabled);
}

#[test]
fn semgrep_text_traces_and_ids() {
    let text = "\n    app/db/queries.py\n   ❯❯❱ home.me.rules.acrw.python.param-to-raw-sql\n          ❰❰ Blocking ❱❱\n          msg\n\n            6┆ f\"SELECT\"\n\n          Taint comes from:\n\n            4┆ async def search_payments(db, user_id: int, q: str):\n\n          Taint flows through these intermediate variables:\n\n            4┆ async def x\n\n                This is how taint reaches the sink:\n\n            6┆ f\"SELECT\"\n\n            ⋮┆----------------------------------------\n            8┆ return await db.execute(stmt)\n\n          Taint comes from:\n\n            4┆ async def x\n\n          Taint flows through these intermediate variables:\n\n            5┆ stmt = text(\n\n                This is how taint reaches the sink:\n\n            8┆ return\n";
    let json = r#"{"results":[
      {"check_id":"home.me.rules.acrw.python.param-to-raw-sql","path":"app/db/queries.py","start":{"line":6},"end":{"line":6},"extra":{"message":"m","severity":"ERROR","metadata":{"title":"SQL","cwe":"CWE-89","category":"Injection"},"lines":"requires login"}},
      {"check_id":"home.me.rules.acrw.python.param-to-raw-sql","path":"app/db/queries.py","start":{"line":8},"end":{"line":8},"extra":{"message":"m","severity":"ERROR","metadata":{},"lines":"requires login"}}],"errors":[]}"#;
    let tmp = tempfile::tempdir().unwrap();
    let rules = tmp.path().join("r.yml");
    std::fs::write(&rules, "rules:\n  - id: acrw.python.param-to-raw-sql\n").unwrap();
    let ids = scan::local_rule_ids(&[rules.to_string_lossy().into_owned()]);
    let out = scan::parse_semgrep(json, Some(text), tmp.path(), &ids).unwrap();
    assert_eq!(out[0].rule_id, "acrw.python.param-to-raw-sql");
    assert_eq!(out[0].severity, "high");
    let t0 = out[0].trace.as_ref().unwrap();
    assert_eq!(t0.source.as_ref().unwrap().line, 4);
    assert_eq!(t0.sink.as_ref().unwrap().line, 6);
    let t1 = out[1].trace.as_ref().unwrap();
    assert_eq!(t1.steps.iter().map(|s| s.line).collect::<Vec<_>>(), vec![5]);
    assert_eq!(t1.sink.as_ref().unwrap().line, 8);
}

#[test]
fn trivy_and_gitleaks_parsers() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("requirements.txt"),
        "fastapi==0.110.0\nrequests==2.31.0\npython-multipart==0.0.6\n",
    )
    .unwrap();
    let tj = r#"{"SchemaVersion":2,"Results":[{"Target":"requirements.txt","Class":"lang-pkgs","Type":"pip","Vulnerabilities":[
      {"VulnerabilityID":"CVE-2024-35195","PkgName":"requests","InstalledVersion":"2.31.0","FixedVersion":"2.32.0","Severity":"MEDIUM","Title":"verify=False persists","PrimaryURL":"https://avd.aquasec.com/nvd/cve-2024-35195","CweIDs":["CWE-670"]},
      {"VulnerabilityID":"CVE-2024-24762","PkgName":"python-multipart","InstalledVersion":"0.0.6","FixedVersion":"0.0.7","Severity":"HIGH"}]}]}"#;
    let t = scan::parse_trivy(tj, tmp.path()).unwrap();
    assert_eq!(t.len(), 2);
    assert_eq!((t[0].line, t[0].severity.as_str()), (2, "medium"));
    assert_eq!(t[1].line, 3);
    assert!(t[0].message.contains("Fixed in 2.32.0"));

    // assembled at runtime so the fixture itself is not a secret-scanner hit
    let fake = format!("sk_{}_{}", "test", "51HfakeFAKEfake");
    std::fs::write(
        tmp.path().join("k.py"),
        format!("x = 1\nKEY = \"{fake}\"\n"),
    )
    .unwrap();
    let gj = r#"[{"Description":"Stripe","StartLine":2,"EndLine":2,"Secret":"REDACTED","File":"k.py","RuleID":"stripe-access-token","Commit":""}]"#;
    let g = scan::parse_gitleaks(gj, tmp.path()).unwrap();
    assert_eq!(g[0].line, 2);
    assert!(
        !g[0].snippet.contains("FAKEfake"),
        "secret must be masked: {}",
        g[0].snippet
    );
    assert!(scan::parse_gitleaks("", tmp.path()).unwrap().is_empty());
}

fn run_engine(scanner: &str, profile: &str) -> (ScanRun, Vec<Finding>) {
    let tmp = tempfile::tempdir().unwrap();
    let repo = demo_repo(tmp.path());
    let c = db::open_in_memory().unwrap();
    let p = db::add_project(&c, &repo).unwrap();
    let run = db::create_run(&c, p.id, scanner, "feature/payment-validation", profile).unwrap();
    let dbh: engine::Db = Arc::new(Mutex::new(c));
    let cancel = AtomicBool::new(false);
    engine::run_scan(
        &dbh,
        &engine::ScanRequest {
            run_id: run.id,
            base: Some("main".into()),
        },
        &tmp.path().join("work"),
        &cancel,
    );
    let c = dbh.lock().unwrap();
    let run = db::get_run(&c, run.id).unwrap();
    let f = db::list_findings(&c, Some(p.id), None).unwrap();
    // the worktree is cleaned up and the user's checkout untouched
    assert_eq!(git::current_branch(&repo).as_deref(), Some("main"));
    let wts = Command::new("git")
        .args(["-C", &repo, "worktree", "list"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&wts.stdout).lines().count(), 1);
    (run, f)
}

#[test]
fn engine_semgrep_end_to_end() {
    if !has("semgrep") {
        eprintln!("semgrep not installed — skipped");
        return;
    }
    let (run, f) = run_engine("Semgrep", "Configured rules");
    assert_eq!(run.status, "completed", "{:?} {}", run.error, run.log);
    let sql: Vec<_> = f
        .iter()
        .filter(|x| x.rule_id == "acrw.python.param-to-raw-sql")
        .collect();
    assert!(!sql.is_empty(), "{f:#?}");
    assert!(
        sql.iter().any(|x| x.trace.is_some()),
        "taint trace expected"
    );
    assert!(f.iter().any(
        |x| x.rule_id == "acrw.python.fastapi.unscoped-object-lookup"
            && x.file == "app/api/routes/refunds.py"
    ));
    assert!(sql[0].snippet.contains("SELECT"));
}

#[test]
fn engine_gitleaks_end_to_end() {
    if !has("gitleaks") {
        eprintln!("gitleaks not installed — skipped");
        return;
    }
    let (run, f) = run_engine("Gitleaks", "Working tree");
    assert_eq!(run.status, "completed", "{:?} {}", run.error, run.log);
    let s = f
        .iter()
        .find(|x| x.rule_id == "generic-api-key")
        .expect("demo API key");
    assert_eq!(s.file, "tests/test_payments.py");
    assert!(
        !s.snippet.contains("4f2a9c0e1b7d"),
        "secret must be masked: {}",
        s.snippet
    );

    let (run, f) = run_engine("Gitleaks", "Git history since merge base");
    assert_eq!(run.status, "completed", "{:?} {}", run.error, run.log);
    assert!(f.iter().any(|x| x.rule_id == "generic-api-key"));
}

#[test]
fn engine_reports_missing_scanner() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = demo_repo(tmp.path());
    let c = db::open_in_memory().unwrap();
    let mut s = db::get_settings(&c).unwrap();
    s.trivy_bin = "/nonexistent/trivy".into();
    db::save_settings(&c, &s).unwrap();
    let p = db::add_project(&c, &repo).unwrap();
    let run = db::create_run(&c, p.id, "Trivy", "main", "Dependencies").unwrap();
    let dbh: engine::Db = Arc::new(Mutex::new(c));
    engine::run_scan(
        &dbh,
        &engine::ScanRequest {
            run_id: run.id,
            base: None,
        },
        &tmp.path().join("w"),
        &AtomicBool::new(false),
    );
    let r = db::get_run(&dbh.lock().unwrap(), run.id).unwrap();
    assert_eq!(r.status, "failed");
    assert!(r.error.unwrap().contains("not found"));
}

#[test]
fn ansi_is_stripped() {
    assert_eq!(
        scan::strip_ansi("\u{1b}[90m11:45PM\u{1b}[0m \u{1b}[32mINF\u{1b}[0m done"),
        "11:45PM INF done"
    );
}
