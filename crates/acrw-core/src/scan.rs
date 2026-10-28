//! Running Semgrep, Trivy and Gitleaks as local processes and turning their
//! reports into [`RawFinding`]s. Scanner output is a lead, never a verdict:
//! every finding starts as `New`.

use crate::model::{RawFinding, Settings, Trace, TraceNode};
use anyhow::{Context, Result, anyhow, bail};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const BUNDLED_PYTHON_RULES: &str = include_str!("../../../rules/acrw-python.yml");
pub const SCANNERS: &[&str] = &["Semgrep", "Trivy", "Gitleaks"];

pub fn profiles(scanner: &str) -> &'static [&'static str] {
    match scanner {
        "Semgrep" => &["Configured rules"],
        "Trivy" => &["Dependencies"],
        "Gitleaks" => &["Working tree", "Git history since merge base"],
        _ => &[],
    }
}

#[derive(Debug, Clone)]
pub struct Invocation {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
    pub outputs: Vec<PathBuf>,
}

impl Invocation {
    pub fn display(&self) -> String {
        let mut s = self.program.clone();
        for a in &self.args {
            s.push(' ');
            if a.contains(' ') {
                s.push('"');
                s.push_str(a);
                s.push('"');
            } else {
                s.push_str(a);
            }
        }
        s
    }
}

fn bin_for<'a>(scanner: &str, s: &'a Settings) -> &'a str {
    match scanner {
        "Semgrep" => &s.semgrep_bin,
        "Trivy" => &s.trivy_bin,
        _ => &s.gitleaks_bin,
    }
}

/// `semgrep --version`, `trivy --version`, `gitleaks version` → "1.94.0".
pub fn version(scanner: &str, s: &Settings) -> Option<String> {
    let bin = bin_for(scanner, s);
    let arg = if scanner == "Gitleaks" {
        "version"
    } else {
        "--version"
    };
    let mut cmd = crate::command(bin);
    cmd.arg(arg).stdin(Stdio::null());
    for (k, v) in offline_env(scanner) {
        cmd.env(k, v);
    }
    let out = cmd.output().ok()?;
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    text.split_whitespace()
        .map(|w| w.trim_start_matches('v'))
        .find(|w| {
            w.chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
                && w.contains('.')
        })
        .map(String::from)
}

/// Keeps scanners from phoning home: no metrics, no update checks.
pub fn offline_env(scanner: &str) -> Vec<(String, String)> {
    match scanner {
        "Semgrep" => vec![
            ("SEMGREP_SEND_METRICS".into(), "off".into()),
            ("SEMGREP_ENABLE_VERSION_CHECK".into(), "0".into()),
        ],
        "Trivy" => vec![("TRIVY_DISABLE_VEX_NOTICE".into(), "true".into())],
        _ => vec![("NO_COLOR".into(), "1".into())],
    }
}

fn version_at_least(v: &str, want: (u32, u32)) -> bool {
    let mut it = v.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let maj = it.next().unwrap_or(0);
    let min = it.next().unwrap_or(0);
    (maj, min) >= want
}

/// Writes bundled rule files and returns the Semgrep `--config` values.
pub fn semgrep_configs(s: &Settings, work: &Path) -> Result<Vec<String>> {
    let mut out = vec![];
    for c in &s.semgrep_configs {
        if c == "bundled:acrw-python" {
            let dir = work.join("rules");
            std::fs::create_dir_all(&dir)?;
            let p = dir.join("acrw-python.yml");
            std::fs::write(&p, BUNDLED_PYTHON_RULES)?;
            out.push(p.to_string_lossy().into_owned());
        } else if !c.trim().is_empty() {
            out.push(c.trim().to_string());
        }
    }
    if out.is_empty() {
        bail!("no Semgrep rule configs are set — add one in Settings › Scanners");
    }
    Ok(out)
}

pub struct GitleaksHistory {
    pub repo: PathBuf,
    pub range: String,
}

pub fn invocation(
    scanner: &str,
    s: &Settings,
    scan_dir: &Path,
    work: &Path,
    gitleaks_version: Option<&str>,
    history: Option<&GitleaksHistory>,
) -> Result<Invocation> {
    std::fs::create_dir_all(work)?;
    let bin = bin_for(scanner, s).to_string();
    let p = |n: &str| work.join(n);
    let sp = |x: &Path| x.to_string_lossy().into_owned();
    Ok(match scanner {
        "Semgrep" => {
            let mut args = vec![
                "scan".into(),
                "--metrics=off".into(),
                "--disable-version-check".into(),
                "--dataflow-traces".into(),
                "--quiet".into(),
            ];
            for c in semgrep_configs(s, work)? {
                args.push("--config".into());
                args.push(c);
            }
            args.push(format!("--json-output={}", sp(&p("semgrep.json"))));
            args.push(format!("--text-output={}", sp(&p("semgrep.txt"))));
            args.push(".".into());
            Invocation {
                program: bin,
                args,
                env: offline_env("Semgrep"),
                cwd: scan_dir.into(),
                outputs: vec![p("semgrep.json"), p("semgrep.txt")],
            }
        }
        "Trivy" => {
            let sev = match s.trivy_min_severity.to_ascii_uppercase().as_str() {
                "CRITICAL" => "CRITICAL",
                "HIGH" => "HIGH,CRITICAL",
                "MEDIUM" => "MEDIUM,HIGH,CRITICAL",
                _ => "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL",
            };
            let mut args: Vec<String> = vec![
                "fs".into(),
                "--scanners".into(),
                "vuln".into(),
                "--format".into(),
                "json".into(),
                "--severity".into(),
                sev.into(),
                "--output".into(),
                sp(&p("trivy.json")),
            ];
            if !s.trivy_db_repository.trim().is_empty() {
                args.push("--db-repository".into());
                args.push(s.trivy_db_repository.trim().into());
            }
            args.push(".".into());
            Invocation {
                program: bin,
                args,
                env: offline_env("Trivy"),
                cwd: scan_dir.into(),
                outputs: vec![p("trivy.json")],
            }
        }
        "Gitleaks" => {
            let modern = gitleaks_version
                .map(|v| version_at_least(v, (8, 19)))
                .unwrap_or(true);
            let report = sp(&p("gitleaks.json"));
            let common: Vec<String> = vec![
                "--report-format".into(),
                "json".into(),
                "--report-path".into(),
                report,
                "--redact".into(),
                "--no-banner".into(),
                "--exit-code".into(),
                "0".into(),
            ];
            let (mut args, cwd): (Vec<String>, PathBuf) = match (history, modern) {
                (Some(h), true) => (
                    vec!["git".into(), format!("--log-opts={}", h.range)],
                    h.repo.clone(),
                ),
                (Some(h), false) => (
                    vec![
                        "detect".into(),
                        "--source".into(),
                        ".".into(),
                        format!("--log-opts={}", h.range),
                    ],
                    h.repo.clone(),
                ),
                (None, true) => (vec!["dir".into(), ".".into()], scan_dir.into()),
                (None, false) => (
                    vec![
                        "detect".into(),
                        "--no-git".into(),
                        "--source".into(),
                        ".".into(),
                    ],
                    scan_dir.into(),
                ),
            };
            args.extend(common);
            Invocation {
                program: bin,
                args,
                env: offline_env("Gitleaks"),
                cwd,
                outputs: vec![p("gitleaks.json")],
            }
        }
        other => bail!("unknown scanner {other}"),
    })
}

/// Removes terminal colour sequences (ESC [ ... letter) from scanner output.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1b}' {
            if it.peek() == Some(&'[') {
                it.next();
                for d in it.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

pub struct Outcome {
    pub exit_code: Option<i32>,
    pub cancelled: bool,
}

/// Runs the process, streaming stderr/stdout lines to `log`, polling `cancel`.
pub fn execute(
    inv: &Invocation,
    cancel: &AtomicBool,
    mut log: impl FnMut(&str),
) -> Result<Outcome> {
    let mut child = crate::command(&inv.program)
        .args(&inv.args)
        .current_dir(&inv.cwd)
        .envs(inv.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| {
            format!(
                "could not start {} — check the binary path in Settings › Scanners",
                inv.program
            )
        })?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let mut readers = vec![];
    if let Some(out) = child.stdout.take() {
        let tx = tx.clone();
        readers.push(std::thread::spawn(move || {
            for l in BufReader::new(out).lines().map_while(|l| l.ok()) {
                let _ = tx.send(l);
            }
        }));
    }
    if let Some(err) = child.stderr.take() {
        let tx = tx.clone();
        readers.push(std::thread::spawn(move || {
            for l in BufReader::new(err).lines().map_while(|l| l.ok()) {
                let _ = tx.send(l);
            }
        }));
    }
    drop(tx);
    let mut lines = 0usize;
    let mut drain = |log: &mut dyn FnMut(&str)| {
        while let Ok(l) = rx.try_recv() {
            let l = strip_ansi(&l);
            let l = l.trim_end();
            if l.trim().is_empty() {
                continue;
            }
            lines += 1;
            if lines <= 400 {
                log(l);
            }
        }
    };
    loop {
        drain(&mut log);
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(Outcome {
                exit_code: None,
                cancelled: true,
            });
        }
        if let Some(st) = child.try_wait()? {
            for r in readers {
                let _ = r.join();
            }
            drain(&mut log);
            if lines > 400 {
                log(&format!("… {} more lines not shown", lines - 400));
            }
            return Ok(Outcome {
                exit_code: st.code(),
                cancelled: false,
            });
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/* ---------------------------------------------------------------- helpers */

pub fn norm_sev(s: &str) -> String {
    match s.to_ascii_uppercase().as_str() {
        "CRITICAL" => "critical",
        "ERROR" | "HIGH" => "high",
        "WARNING" | "MEDIUM" | "MODERATE" => "medium",
        "LOW" => "low",
        _ => "info",
    }
    .to_string()
}

fn norm_path(p: &str) -> String {
    p.replace('\\', "/").trim_start_matches("./").to_string()
}

fn read_lines(dir: &Path, file: &str, start: u32, end: u32) -> String {
    let Ok(text) = std::fs::read_to_string(dir.join(file)) else {
        return String::new();
    };
    let end = end.max(start);
    text.lines()
        .skip(start.saturating_sub(1) as usize)
        .take((end - start + 1).min(12) as usize)
        .collect::<Vec<_>>()
        .join("\n")
}

fn line_content(dir: &Path, file: &str, line: u32) -> String {
    read_lines(dir, file, line, line).trim().to_string()
}

fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(str_of).collect::<Vec<_>>().join(", "),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/* ---------------------------------------------------------------- semgrep */

/// Rule ids declared in local rule files (`- id: ...`).
pub fn local_rule_ids(configs: &[String]) -> Vec<String> {
    let mut ids = vec![];
    for c in configs {
        if let Ok(text) = std::fs::read_to_string(c) {
            for l in text.lines() {
                let t = l.trim_start();
                if let Some(rest) = t.strip_prefix("- id:") {
                    ids.push(rest.trim().trim_matches(['"', '\'']).to_string());
                }
            }
        }
    }
    ids.sort_by_key(|i| std::cmp::Reverse(i.len()));
    ids
}

/// Semgrep prefixes ids of local rules with the rule file's directory
/// (`home.me.rules.acrw.python...`); map them back to the declared id.
pub fn clean_rule_id(id: &str, local_ids: &[String]) -> String {
    for rid in local_ids {
        if id == rid || id.ends_with(&format!(".{rid}")) {
            return rid.clone();
        }
    }
    id.to_string()
}

#[derive(Debug, Default, Clone)]
struct TextTrace {
    file: String,
    rule: String,
    line: Option<u32>,
    source: Vec<u32>,
    steps: Vec<u32>,
    sink: Vec<u32>,
}

/// Semgrep only prints dataflow traces in its text report, so we read them there.
fn parse_semgrep_text_traces(text: &str) -> Vec<TextTrace> {
    let mut out: Vec<TextTrace> = vec![];
    let mut cur = TextTrace::default();
    let mut mode = 0u8; // 0 match, 1 source, 2 steps, 3 sink
    let flush = |cur: &mut TextTrace, out: &mut Vec<TextTrace>| {
        if cur.line.is_some() && (!cur.source.is_empty() || !cur.sink.is_empty()) {
            out.push(cur.clone());
        }
        cur.line = None;
        cur.source.clear();
        cur.steps.clear();
        cur.sink.clear();
    };
    for raw in text.lines() {
        let l = raw.trim_end();
        let t = l.trim();
        if t.is_empty() {
            continue;
        }
        if let Some((num, _)) = t.split_once('┆') {
            let num = num.trim();
            if num == "⋮" {
                flush(&mut cur, &mut out);
                mode = 0;
                continue;
            }
            if let Ok(n) = num.parse::<u32>() {
                match mode {
                    0 => {
                        if cur.line.is_none() {
                            cur.line = Some(n)
                        }
                    }
                    1 => cur.source.push(n),
                    2 => cur.steps.push(n),
                    _ => cur.sink.push(n),
                }
            }
            continue;
        }
        if t.starts_with("Taint comes from") {
            mode = 1;
            continue;
        }
        if t.starts_with("Taint flows through") {
            mode = 2;
            continue;
        }
        if t.starts_with("This is how taint reaches the sink") {
            mode = 3;
            continue;
        }
        if t.contains('❱') && !t.contains("Blocking") {
            flush(&mut cur, &mut out);
            cur.rule = t.rsplit(' ').next().unwrap_or("").to_string();
            mode = 0;
            continue;
        }
        // file header: 4-space indent, no box drawing, looks like a path
        let indent = l.len() - l.trim_start().len();
        if indent == 4
            && !t.contains(' ')
            && (t.contains('.') || t.contains('/'))
            && !t.starts_with('❰')
        {
            flush(&mut cur, &mut out);
            cur.file = norm_path(t);
            mode = 0;
        }
    }
    flush(&mut cur, &mut out);
    out
}

fn node(dir: &Path, file: &str, line: u32) -> TraceNode {
    TraceNode {
        file: file.to_string(),
        line,
        content: line_content(dir, file, line),
    }
}

fn trace_from_json(v: &Value, dir: &Path) -> Option<Trace> {
    // Older Semgrep JSON: {"taint_source": ["CliLoc", [loc, content]], "intermediate_vars": [...], "taint_sink": [...]}
    fn first_loc(v: &Value) -> Option<(String, u32, String)> {
        match v {
            Value::Object(o) if o.contains_key("path") && o.contains_key("start") => {
                let p = o.get("path")?.as_str()?.to_string();
                let l = o.get("start")?.get("line")?.as_u64()? as u32;
                Some((p, l, String::new()))
            }
            Value::Array(a) => {
                if a.len() == 2
                    && let (Some((p, l, _)), Some(c)) = (first_loc(&a[0]), a[1].as_str())
                {
                    return Some((p, l, c.to_string()));
                }
                a.iter().find_map(first_loc)
            }
            Value::Object(o) => o.values().find_map(first_loc),
            _ => None,
        }
    }
    let mk = |x: Option<(String, u32, String)>| {
        x.map(|(p, l, c)| {
            let f = norm_path(&p);
            TraceNode {
                content: if c.is_empty() {
                    line_content(dir, &f, l)
                } else {
                    c
                },
                file: f,
                line: l,
            }
        })
    };
    let source = mk(v.get("taint_source").and_then(first_loc));
    let sink = mk(v.get("taint_sink").and_then(first_loc));
    let steps = v
        .get("intermediate_vars")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|i| {
                    mk(i.get("location")
                        .and_then(first_loc)
                        .map(|(p, l, _)| (p, l, i.get("content").map(str_of).unwrap_or_default())))
                })
                .collect()
        })
        .unwrap_or_default();
    if source.is_none() && sink.is_none() {
        return None;
    }
    Some(Trace {
        source,
        steps,
        sink,
    })
}

pub fn parse_semgrep(
    json: &str,
    text: Option<&str>,
    dir: &Path,
    local_ids: &[String],
) -> Result<Vec<RawFinding>> {
    let v: Value = serde_json::from_str(json).context("Semgrep JSON report is not valid JSON")?;
    let traces = text.map(parse_semgrep_text_traces).unwrap_or_default();
    let mut tmap: HashMap<(String, u32, String), &TextTrace> = HashMap::new();
    for t in &traces {
        if let Some(l) = t.line {
            tmap.insert((t.file.clone(), l, clean_rule_id(&t.rule, local_ids)), t);
        }
    }
    let mut out = vec![];
    for r in v
        .get("results")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default()
    {
        let rule = clean_rule_id(
            r.get("check_id")
                .and_then(|x| x.as_str())
                .unwrap_or("semgrep"),
            local_ids,
        );
        let file = norm_path(r.get("path").and_then(|x| x.as_str()).unwrap_or(""));
        let line = r
            .pointer("/start/line")
            .and_then(|x| x.as_u64())
            .unwrap_or(1) as u32;
        let end_line = r
            .pointer("/end/line")
            .and_then(|x| x.as_u64())
            .unwrap_or(line as u64) as u32;
        let extra = r.get("extra").cloned().unwrap_or(Value::Null);
        let meta = extra.get("metadata").cloned().unwrap_or(Value::Null);
        let message = extra.get("message").map(str_of).unwrap_or_default();
        let lines = extra.get("lines").and_then(|x| x.as_str()).unwrap_or("");
        let snippet = if lines.is_empty() || lines == "requires login" {
            read_lines(dir, &file, line, end_line)
        } else {
            lines.to_string()
        };
        let short = rule.rsplit('.').next().unwrap_or(&rule).replace('-', " ");
        let title = meta
            .get("title")
            .map(str_of)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                let mut c = short.chars();
                c.next()
                    .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                    .unwrap_or_default()
            });
        let category = meta.get("category").map(str_of).unwrap_or_default();
        let cwe = meta.get("cwe").map(str_of).unwrap_or_default();
        let sev = extra
            .get("severity")
            .and_then(|x| x.as_str())
            .unwrap_or("INFO");
        let mut trace = extra
            .get("dataflow_trace")
            .and_then(|d| trace_from_json(d, dir));
        if trace.is_none()
            && let Some(t) = tmap.get(&(file.clone(), line, rule.clone()))
        {
            trace = Some(Trace {
                source: t.source.first().map(|l| node(dir, &file, *l)),
                steps: t
                    .steps
                    .iter()
                    .filter(|l| Some(**l) != t.source.first().copied())
                    .map(|l| node(dir, &file, *l))
                    .collect(),
                sink: t.sink.first().map(|l| node(dir, &file, *l)),
            });
        }
        out.push(RawFinding {
            scanner: "Semgrep".into(),
            rule_id: rule,
            title,
            message,
            severity: norm_sev(sev),
            category: if category.is_empty() {
                "Code".into()
            } else {
                category
            },
            cwe,
            file,
            line,
            end_line,
            snippet,
            trace,
        });
    }
    Ok(out)
}

pub fn semgrep_errors(json: &str) -> Vec<String> {
    serde_json::from_str::<Value>(json)
        .ok()
        .and_then(|v| v.get("errors").and_then(|e| e.as_array()).cloned())
        .unwrap_or_default()
        .iter()
        .filter(|e| e.get("level").and_then(|l| l.as_str()) != Some("warn"))
        .filter_map(|e| {
            e.get("message")
                .and_then(|m| m.as_str())
                .map(|m| m.lines().next().unwrap_or("").to_string())
        })
        .collect()
}

/* ---------------------------------------------------------------- trivy */

fn find_line(dir: &Path, file: &str, needle: &str) -> u32 {
    let Ok(text) = std::fs::read_to_string(dir.join(file)) else {
        return 1;
    };
    let n = needle.to_ascii_lowercase();
    let alt = n.replace('-', "_");
    for (i, l) in text.lines().enumerate() {
        let ll = l.to_ascii_lowercase();
        let ll = ll.trim_start_matches(['"', '\'', ' ']);
        if ll.starts_with(&n)
            || ll.starts_with(&alt)
            || ll.contains(&format!("\"{n}\""))
            || ll.contains(&format!("include=\"{n}\""))
        {
            return i as u32 + 1;
        }
    }
    1
}

pub fn parse_trivy(json: &str, dir: &Path) -> Result<Vec<RawFinding>> {
    let v: Value = serde_json::from_str(json).context("Trivy JSON report is not valid JSON")?;
    let mut out = vec![];
    for res in v
        .get("Results")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default()
    {
        let target = norm_path(res.get("Target").and_then(|x| x.as_str()).unwrap_or(""));
        for vu in res
            .get("Vulnerabilities")
            .and_then(|x| x.as_array())
            .cloned()
            .unwrap_or_default()
        {
            let id = vu.get("VulnerabilityID").map(str_of).unwrap_or_default();
            let pkg = vu.get("PkgName").map(str_of).unwrap_or_default();
            let installed = vu.get("InstalledVersion").map(str_of).unwrap_or_default();
            let fixed = vu.get("FixedVersion").map(str_of).unwrap_or_default();
            let line = vu
                .pointer("/PkgIdentifier/Locations/0/StartLine")
                .or_else(|| vu.pointer("/Locations/0/StartLine"))
                .and_then(|x| x.as_u64())
                .map(|x| x as u32)
                .unwrap_or_else(|| find_line(dir, &target, &pkg));
            let title = vu.get("Title").map(str_of).unwrap_or_default();
            let url = vu.get("PrimaryURL").map(str_of).unwrap_or_default();
            let mut message = format!("{pkg} {installed} is affected by {id}.");
            if !fixed.is_empty() {
                message.push_str(&format!(" Fixed in {fixed}."));
            } else {
                message.push_str(" No fixed version is published.");
            }
            if !title.is_empty() {
                message.push(' ');
                message.push_str(&title);
            }
            if !url.is_empty() {
                message.push_str(&format!(" ({url})"));
            }
            out.push(RawFinding {
                scanner: "Trivy".into(),
                rule_id: id.clone(),
                title: format!("Vulnerable dependency: {pkg} {installed}"),
                message,
                severity: norm_sev(
                    vu.get("Severity")
                        .and_then(|x| x.as_str())
                        .unwrap_or("UNKNOWN"),
                ),
                category: "Dependency".into(),
                cwe: vu.get("CweIDs").map(str_of).unwrap_or_default(),
                file: target.clone(),
                line,
                end_line: line,
                snippet: line_content(dir, &target, line),
                trace: None,
            });
        }
    }
    Ok(out)
}

/* ---------------------------------------------------------------- gitleaks */

pub fn parse_gitleaks(json: &str, dir: &Path) -> Result<Vec<RawFinding>> {
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let v: Value =
        serde_json::from_str(trimmed).context("Gitleaks JSON report is not valid JSON")?;
    let arr = v
        .as_array()
        .ok_or_else(|| anyhow!("Gitleaks report is not a list"))?;
    let mut out = vec![];
    for g in arr {
        let file = norm_path(g.get("File").and_then(|x| x.as_str()).unwrap_or(""));
        let line = g.get("StartLine").and_then(|x| x.as_u64()).unwrap_or(1) as u32;
        let end_line = g
            .get("EndLine")
            .and_then(|x| x.as_u64())
            .unwrap_or(line as u64) as u32;
        let rule = g
            .get("RuleID")
            .map(str_of)
            .unwrap_or_else(|| "secret".into());
        let commit = g.get("Commit").map(str_of).unwrap_or_default();
        let desc = g.get("Description").map(str_of).unwrap_or_default();
        // Never keep the secret itself: the report is produced with --redact and
        // the snippet is masked again here.
        let snippet = redact_line(
            &line_content(dir, &file, line),
            g.get("Secret").and_then(|x| x.as_str()),
        );
        let mut message = if desc.is_empty() {
            "A value matching a secret pattern is committed.".to_string()
        } else {
            desc
        };
        if !commit.is_empty() {
            message.push_str(&format!(" Commit {}.", &commit[..commit.len().min(7)]));
        }
        message.push_str(" The value is redacted; verify whether it is live before rotating.");
        out.push(RawFinding {
            scanner: "Gitleaks".into(),
            rule_id: rule.clone(),
            title: format!("Potential hardcoded secret: {rule}"),
            message,
            severity: "high".into(),
            category: "Secrets".into(),
            cwe: "CWE-798".into(),
            file,
            line,
            end_line,
            snippet,
            trace: None,
        });
    }
    Ok(out)
}

/// Masks string literals and long token-like words in a line of source.
pub fn redact_line(line: &str, secret: Option<&str>) -> String {
    let mut s = line.to_string();
    if let Some(sec) = secret
        && !sec.is_empty()
        && sec != "REDACTED"
    {
        s = s.replace(sec, "••••••••");
    }
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' || c == '\'' {
            let q = c;
            let mut lit = String::new();
            let mut closed = false;
            for d in chars.by_ref() {
                if d == q {
                    closed = true;
                    break;
                }
                lit.push(d);
            }
            out.push(q);
            if lit.chars().count() > 6 {
                let keep: String = lit.chars().take(4).collect();
                out.push_str(&keep);
                out.push_str("••••••••");
            } else {
                out.push_str(&lit);
            }
            if closed {
                out.push(q);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/* ---------------------------------------------------------------- driver */

pub struct ParsedRun {
    pub findings: Vec<RawFinding>,
    pub warnings: Vec<String>,
}

/// Reads the report files an invocation produced.
pub fn collect(
    scanner: &str,
    inv: &Invocation,
    scan_dir: &Path,
    local_ids: &[String],
) -> Result<ParsedRun> {
    let read = |p: &PathBuf| std::fs::read_to_string(p).ok();
    match scanner {
        "Semgrep" => {
            let json =
                read(&inv.outputs[0]).ok_or_else(|| anyhow!("Semgrep did not write a report"))?;
            let text = read(&inv.outputs[1]);
            Ok(ParsedRun {
                findings: parse_semgrep(&json, text.as_deref(), scan_dir, local_ids)?,
                warnings: semgrep_errors(&json),
            })
        }
        "Trivy" => {
            let json =
                read(&inv.outputs[0]).ok_or_else(|| anyhow!("Trivy did not write a report"))?;
            Ok(ParsedRun {
                findings: parse_trivy(&json, scan_dir)?,
                warnings: vec![],
            })
        }
        "Gitleaks" => {
            let json = read(&inv.outputs[0]).unwrap_or_else(|| "[]".into());
            Ok(ParsedRun {
                findings: parse_gitleaks(&json, scan_dir)?,
                warnings: vec![],
            })
        }
        other => bail!("unknown scanner {other}"),
    }
}
