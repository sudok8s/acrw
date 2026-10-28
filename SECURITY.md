# Security policy

ACRW is a security tool, so we take reports about ACRW itself seriously.

## Supported versions

Only the latest release and `main` receive fixes while ACRW is in its MVP phase.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, the affected version or commit and
the impact you expect. We aim to acknowledge reports within 5 working days and
to agree on a disclosure date with you.

## In scope

- Code execution, file writes or Git changes caused by opening or scanning a
  repository (ACRW must stay read-only towards reviewed repositories)
- Data leaving the machine without the user's action
- Secret values from scanner output being stored or shown unredacted
- Weaknesses in the Tauri configuration (IPC permissions, CSP)

## Out of scope

- Findings that Semgrep, Trivy or Gitleaks report in *your* code — those are
  what ACRW is for
- Vulnerabilities in the scanners themselves; report those to their projects
