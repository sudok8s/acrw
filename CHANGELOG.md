# Changelog

All notable changes are listed here. The project follows
[Semantic Versioning](https://semver.org/); until 1.0 minor versions may break
the local database.

## [0.1.0] — MVP

### Added
- Review workspace: three-dot changesets, change explorer with filters and
  per-file reviewed state, Monaco diff (unified / side-by-side), finding markers
  and inline notes, security-context pane with workflow status and notes.
- Local scans with Semgrep, Trivy and Gitleaks in a temporary worktree;
  background runs with live log, cancel and retry; fingerprint-based
  de-duplication that keeps status and notes.
- Findings hub with search, filters, sorting and detail panel.
- Source → sink explorer built from Semgrep taint traces; bundled Python taint
  rules.
- Overview, projects, settings, command palette and keyboard shortcuts.
- Browser demo mode with a recorded dataset.
