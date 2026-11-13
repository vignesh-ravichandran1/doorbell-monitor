# doorbell-monitor: notes for Claude

Records a Ring doorbell's live view on ding/motion to mp4 (no Ring subscription), serves a
phone-friendly clips page with PIN / Face ID unlock, settings and one-tap updates.
Node 22, ESM, plain JS, 3 deps (ring-client-api, rxjs, @simplewebauthn/server). No build step.

## Rules
- Never read or change `.env`, `.ring-token`, `data/passkeys.json`, `recordings/`.
- `npm test` must end with `# fail 0` before any commit that touches code. It takes ~45 s: run it in the background.
- Commit only when asked or when the task says so; push fast-forward to `origin master`, never force.
  Subject = the user-visible effect in plain English; body says why; end with the Co-Authored-By line.
- Style: no semicolons, 2 spaces, single quotes, comments explain *why*, user-facing text is
  plain English (the owner reads logs and the page on a phone).
- Changing `windows/start-doorbell.bat` can't be applied by a phone update (see kb/updates.md).

## Knowledge base: read only the file the task needs
| File | Read when |
|---|---|
| [docs/kb/architecture.md](docs/kb/architecture.md) | Any code change: module map, event→clip flow, files on disk |
| [docs/kb/web-and-api.md](docs/kb/web-and-api.md) | Clips page, settings, PIN/passkeys, HTTP routes |
| [docs/kb/updates.md](docs/kb/updates.md) | "Update & restart", updater/guard, rollbacks |
| [docs/kb/windows-deployment.md](docs/kb/windows-deployment.md) | The laptop: SYSTEM task, logs, restart, debugging as SYSTEM |
| [docs/kb/testing.md](docs/kb/testing.md) | Writing/fixing tests, test env gotchas |
| [docs/kb/history.md](docs/kb/history.md) | Past incidents and why things are the way they are |

User docs (for the owner, not for Claude): README.md, SETUP.md, ROADMAP.md.

## Saving tokens
- Every `src/*.js` starts with a header comment saying what it does: read headers first
  (`head -8 src/*.js`) and grep before opening whole files. `src/web/index.html` is ~1000 lines:
  grep it, never read it whole.
- Logs are noisy (`[push debug]`, ffmpeg `frame=` lines). Filter, e.g.
  `grep -hiE "update|restart|rolled|recorder (started|stopping)|CRASH" logs/recorder-*.log | tail`.
- Edit files with Backslash paths (Windows) using the Edit tool, not sed/heredocs: `\r` gets mangled.

## Keeping this up to date
When a change alters behaviour, a flow, a file's role or a gotcha documented here, update the
matching kb file in the same commit. Add a line to kb/history.md for any incident worth
remembering. Keep this file under ~60 lines: details go in kb files.
