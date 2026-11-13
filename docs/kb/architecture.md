# Architecture

## Flow: event → clip
1. `main.js` logs in to Ring (`config.loadToken()`: `.ring-token` beats `.env`; Ring rotates the
   token, `saveToken` keeps the newest), subscribes per camera to `onNewNotification` (ding) and
   `onMotionDetected`.
2. `handle(camera, event)`: notify (ntfy, if `NTFY_TOPIC`; repeat motion alerts are muted for
   MOTION_COOLDOWN_SECONDS, recording is not); if a clip is already
   running for that camera its `ClipSession` is extended instead of starting a new one
   (`recording` Map: camera id → session).
3. `recorder.record()` streams live view → ffmpeg → `<recordings>/YYYY-MM-DD/HHMMSS_<event>_<camera>.mp4`.
   On Windows ffmpeg is killed outright, so fragments are cut every ≤0.5 s and recording runs 1 s longer.
4. `thumbnail.makeThumbnail()` picks the most telling frame → `.jpg` next to the mp4.
5. `housekeeping()` → `storage.prune()` (KEEP_DAYS, MAX_STORAGE_GB, MIN_FREE_GB); also hourly.

## Modules (src/)
| File | Role |
|---|---|
| main.js | Entry: wiring above, starts server, `onRestart`, `markHealthy` 60 s after "waiting for rings and motion" |
| config.js | Loads `.env` into `process.env` (unless `DOORBELL_IGNORE_ENV_FILE`), `config` object, `ENV_KEYS`, token, ffmpeg path, `updateEnvText` |
| clip-session.js | How long a clip runs; new activity extends it up to MAX_CLIP_SECONDS |
| recorder.js | One clip from live view via ffmpeg |
| thumbnail.js | Frame choice: ding = best frame just after ring; motion = most different from empty scene, not blurry |
| storage.js | Clip paths, listing, pruning, `clipSummary` for the page, `deleteClips` |
| server.js | HTTP: page, clips (Range support for iPhone), settings/auth/update APIs → see web-and-api.md |
| settings.js | `FIELDS` editable from the page, validation, writes `.env`, PIN hash, `Sessions` |
| passkeys.js | WebAuthn (Face ID / Windows Hello); only on https or localhost; stored in data/passkeys.json |
| updater.js / update-guard.js | Phone updates + rollback → see updates.md. Node built-ins only |
| lifecycle.js | Daily log file `logs/recorder-YYYY-MM-DD.log` (30 days), `logs/state.json`, stop reasons, sleep/stall gaps, `stop-request` file |
| push-debug.js | Makes Ring's push connection visible in the log (`--debug` = raw pushes) |
| doctor.js / setup.js / record-check.js / rethumb.js | CLI tools: `npm run doctor`, `setup`/`login`/`pin`, `test-clip`, `rethumb` |
| web/index.html | The whole clips page (HTML+CSS+one script), ~1000 lines |

`scripts/patch-push-receiver.cjs` (postinstall) patches two crash bugs in @eneris/push-receiver.
`scripts/test.mjs` = `npm test` wrapper (see testing.md).

## Files on disk (all gitignored)
- `.env` settings (template `.env.example`), `.ring-token`
- `data/`: passkeys.json, update.json (update on probation), update-rolled-back.json
- `logs/`: recorder-*.log, state.json (pid, lastAlive, stoppedAt/stopReason), stop-request
- `recordings/` (or RECORDINGS_PATH)

## Exit codes (read by windows/start-doorbell.bat)
0 = restart me (also after an update), 1 = crashed (restart), 3 = don't restart
(stop-recorder.bat, or another recorder already holds the port).
