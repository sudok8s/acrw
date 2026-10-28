//! Read-only Git access: branches, three-dot changesets, file contents.
//! Scanning a revision uses a detached `git worktree` so the user's
//! working copy is never touched.

use crate::model::{ChangedFile, FileDiff};
use anyhow::{Context, Result, anyhow, bail};
use git2::{Delta, DiffFindOptions, DiffOptions, Oid, Repository};
use std::path::{Path, PathBuf};

pub fn open(path: &str) -> Result<Repository> {
    Repository::open(path).with_context(|| format!("{path} is not a Git repository"))
}

/// Returns the repository root for any path inside a work tree.
pub fn discover_root(path: &str) -> Result<String> {
    let repo = Repository::discover(path)
        .with_context(|| format!("{path} is not inside a Git repository"))?;
    let wd = repo
        .workdir()
        .ok_or_else(|| anyhow!("bare repositories are not supported"))?;
    Ok(wd
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string())
}

pub fn resolve(repo: &Repository, rev: &str) -> Result<Oid> {
    let obj = repo
        .revparse_single(rev)
        .with_context(|| format!("unknown revision {rev}"))?;
    Ok(obj.peel_to_commit()?.id())
}

pub fn short(oid: Oid) -> String {
    oid.to_string()[..7].to_string()
}

/// Local branches first (current branch first), then remote-tracking branches.
pub fn list_branches(path: &str) -> Result<Vec<String>> {
    let repo = open(path)?;
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(String::from));
    let mut local = vec![];
    let mut remote = vec![];
    for b in repo.branches(None)? {
        let (b, kind) = b?;
        if let Some(name) = b.name()? {
            if name.ends_with("/HEAD") {
                continue;
            }
            match kind {
                git2::BranchType::Local => local.push(name.to_string()),
                git2::BranchType::Remote => remote.push(name.to_string()),
            }
        }
    }
    local.sort();
    remote.sort();
    if let Some(h) = head
        && let Some(i) = local.iter().position(|b| *b == h)
    {
        let cur = local.remove(i);
        local.insert(0, cur);
    }
    local.extend(remote);
    Ok(local)
}

pub fn current_branch(path: &str) -> Option<String> {
    let repo = open(path).ok()?;
    let h = repo.head().ok()?;
    h.shorthand().ok().map(String::from)
}

/// Picks a sensible default base: main, master, develop, else the first branch.
pub fn default_base(path: &str) -> Option<String> {
    let branches = list_branches(path).ok()?;
    for c in ["main", "master", "develop", "origin/main", "origin/master"] {
        if branches.iter().any(|b| b == c) {
            return Some(c.to_string());
        }
    }
    branches.into_iter().next()
}

/// (merge base, target) commit ids for a three-dot comparison base...target.
pub fn compare_points(repo: &Repository, base: &str, target: &str) -> Result<(Oid, Oid)> {
    let b = resolve(repo, base)?;
    let t = resolve(repo, target)?;
    let mb = repo
        .merge_base(b, t)
        .with_context(|| format!("{base} and {target} have no common ancestor"))?;
    Ok((mb, t))
}

fn status_letter(d: Delta) -> &'static str {
    match d {
        Delta::Added | Delta::Untracked => "A",
        Delta::Deleted => "D",
        Delta::Renamed => "R",
        _ => "M",
    }
}

/// Files changed on `target` since its merge base with `base` (three-dot).
pub fn changed_files(path: &str, base: &str, target: &str) -> Result<Vec<ChangedFile>> {
    let repo = open(path)?;
    let (mb, t) = compare_points(&repo, base, target)?;
    let old_tree = repo.find_commit(mb)?.tree()?;
    let new_tree = repo.find_commit(t)?.tree()?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3);
    let mut diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut opts))?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;
    let mut out = vec![];
    for (i, delta) in diff.deltas().enumerate() {
        let status = status_letter(delta.status());
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        let p = if status == "D" {
            old_path.clone()
        } else {
            new_path.clone()
        };
        let Some(p) = p else { continue };
        let binary = delta.flags().is_binary()
            || delta.new_file().is_binary()
            || delta.old_file().is_binary();
        let (mut add, mut del) = (0, 0);
        if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, i)
            && let Ok((_, a, d)) = patch.line_stats()
        {
            add = a;
            del = d;
        }
        out.push(ChangedFile {
            path: p,
            old_path: if status == "R" { old_path } else { None },
            status: status.to_string(),
            additions: add,
            deletions: del,
            binary,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn blob_text(repo: &Repository, commit: Oid, file: &str) -> Result<Option<(String, bool)>> {
    let tree = repo.find_commit(commit)?.tree()?;
    let entry = match tree.get_path(Path::new(file)) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let blob = entry.to_object(repo)?.peel_to_blob()?;
    if blob.is_binary() {
        return Ok(Some((String::new(), true)));
    }
    Ok(Some((
        String::from_utf8_lossy(blob.content()).into_owned(),
        false,
    )))
}

pub fn language_for(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "py" => "python",
        "cs" => "csharp",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "tsx" => "typescript",
        "go" => "go",
        "rs" => "rust",
        "java" => "java",
        "rb" => "ruby",
        "php" => "php",
        "json" => "json",
        "yml" | "yaml" => "yaml",
        "toml" => "ini",
        "xml" | "csproj" => "xml",
        "md" => "markdown",
        "sql" => "sql",
        "sh" => "shell",
        "html" => "html",
        "css" => "css",
        _ if lower.ends_with("dockerfile") => "dockerfile",
        _ => "plaintext",
    }
}

pub fn file_diff(
    path: &str,
    base: &str,
    target: &str,
    file: &str,
    old_path: Option<&str>,
) -> Result<FileDiff> {
    let repo = open(path)?;
    let (mb, t) = compare_points(&repo, base, target)?;
    let old = blob_text(&repo, mb, old_path.unwrap_or(file))?;
    let new = blob_text(&repo, t, file)?;
    let binary =
        old.as_ref().map(|o| o.1).unwrap_or(false) || new.as_ref().map(|n| n.1).unwrap_or(false);
    let status = match (&old, &new) {
        (None, Some(_)) => "A",
        (Some(_), None) => "D",
        _ if old_path.is_some() && old_path != Some(file) => "R",
        _ => "M",
    };
    Ok(FileDiff {
        path: file.to_string(),
        old_path: old_path.map(String::from),
        status: status.into(),
        binary,
        original: old.map(|o| o.0),
        modified: new.map(|n| n.0),
        language: language_for(file).into(),
        base_commit: short(mb),
        target_commit: short(t),
    })
}

/// Source text of a file at a revision (for snippets outside the changeset).
pub fn file_at(path: &str, rev: &str, file: &str) -> Result<Option<String>> {
    let repo = open(path)?;
    let c = resolve(&repo, rev)?;
    Ok(blob_text(&repo, c, file)?.and_then(|(t, bin)| if bin { None } else { Some(t) }))
}

/// A detached worktree of `rev`, removed when dropped.
pub struct Checkout {
    repo: String,
    pub dir: PathBuf,
    pub commit: String,
}

impl Checkout {
    pub fn create(repo_path: &str, rev: &str, parent: &Path) -> Result<Checkout> {
        let repo = open(repo_path)?;
        let oid = resolve(&repo, rev)?;
        std::fs::create_dir_all(parent)?;
        let dir = parent.join(format!("wt-{}-{}", short(oid), crate::model::now()));
        let out = crate::command("git")
            .arg("-C")
            .arg(repo_path)
            .args(["worktree", "add", "--detach", "--force"])
            .arg(&dir)
            .arg(oid.to_string())
            .output()
            .context("could not run git — is it on PATH?")?;
        if !out.status.success() {
            bail!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(Checkout {
            repo: repo_path.to_string(),
            dir,
            commit: short(oid),
        })
    }
}

impl Drop for Checkout {
    fn drop(&mut self) {
        let _ = crate::command("git")
            .arg("-C")
            .arg(&self.repo)
            .args(["worktree", "remove", "--force"])
            .arg(&self.dir)
            .output();
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = crate::command("git")
            .arg("-C")
            .arg(&self.repo)
            .args(["worktree", "prune"])
            .output();
    }
}
