# Bundled Semgrep rules

`acrw-python.yml` is embedded into the ACRW binary and used when Settings ›
Scanners › Rule configs contains `bundled:acrw-python` (the default).

| Rule | Mode | What it flags |
| --- | --- | --- |
| `acrw.python.param-to-raw-sql` | taint | A function argument reaching `text()` / `execute()` unbound |
| `acrw.python.fastapi.request-to-sql` | taint | A FastAPI route parameter reaching raw SQL |
| `acrw.python.fastapi.unscoped-object-lookup` | search | `await svc.get(db, id)` from a path id while an authenticated user is available |
| `acrw.python.sensitive-arg-in-log` | taint | Account or payment identifiers written to logs |
| `acrw.python.jwt-unverified-decode` | search | `jwt.decode(..., options={"verify_signature": False})` |

## Writing rules

- Prefer **taint mode** — its traces drive the Source → sink explorer.
- Give each rule `metadata.title`, `metadata.category` and `metadata.cwe`; ACRW
  shows them in the UI.
- Write messages that state what was seen and what still needs checking, not a
  verdict.
- Test locally: `semgrep scan --config rules/acrw-python.yml --dataflow-traces <repo>`
  and against the demo repository (`npm run demo-repo`).
