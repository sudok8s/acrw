# Contributing to ACRW

Thanks for helping. ACRW is an MVP, so small, focused changes are easiest to
review.

## Ways to help

- **Report a bug** or rough edge — use the bug template and include your OS,
  scanner versions and what you expected.
- **Add or improve Semgrep rules** in [`rules/`](rules/README.md). Rules that
  produce dataflow traces (taint mode) light up the Source → sink explorer.
- **Improve parsers** for scanner output — attach a redacted sample report.
- **Pick an issue** labelled `good first issue` or `help wanted`.

For larger changes, open an issue first so we can agree on the approach.

## Development setup

```bash
npm run setup                 # Tauri CLI + UI dependencies
npm run dev                   # desktop app with hot reload
npm run ui                    # UI only, in a browser, with demo data
npm run demo-repo -- /tmp/payments-api   # sample repository to review
```

Requirements are listed in the [README](README.md#build-from-source).

## Before you open a pull request

```bash
cargo fmt --all
cargo clippy --workspace -- -D warnings
cargo test -p acrw-core       # end-to-end scanner tests run when semgrep/gitleaks are installed
npm --prefix ui run build     # type-check and bundle
```

- Keep the core (`crates/acrw-core`) free of UI and Tauri concerns.
- ACRW must stay **read-only** towards the repositories it reviews and must not
  send data over the network on its own. Changes that touch either need an
  explicit note in the PR.
- UI follows the ACRW design tokens in `ui/src/styles.css`: dense, dark,
  crimson used sparingly; severity and workflow status are always separate.
- Write UI copy as review notes from a colleague: plain, specific, no hype.
  Scanner results are leads, never "vulnerabilities" until an analyst confirms.
- Add tests for parsers and git logic; fixtures must not contain real secrets
  (assemble fake ones at runtime if a scanner needs to match them).

## Commit and PR style

- Imperative, short subject (`Parse Trivy locations for npm lockfiles`).
- One logical change per PR; describe what you tested.
- By contributing you agree your work is licensed under the
  [Apache License 2.0](LICENSE).
