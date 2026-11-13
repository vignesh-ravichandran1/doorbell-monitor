# One-tap updates (Settings → App updates)

## Pipeline
1. `POST /api/update/check` → `updater.check()`: `git fetch`, compares HEAD with `@{u}`. Refuses
   when the laptop has local commits, edited tracked files, or the update changes
   `windows/start-doorbell.bat` (cmd.exe is executing it; must be updated at the laptop).
2. `POST /api/update/apply` → `updater.apply()`: `git merge --ff-only @{u}`, `npm install`,
   `npm test`. Any failure → `git reset --hard <from>` + reinstall, error "failed its checks and
   was undone. Details: <failing tests>" (full text is in the log and on the page).
3. Success → writes `data/update.json` {from,to,at,starts}, responds, then `onRestart` →
   `lifecycle.stop('restarting to run the updated version')` → exit 0.
4. `start-doorbell.bat` loop: `node src/update-guard.js` then `node src/main.js`.
   `guard()` counts starts; >3 starts or >10 min without being healthy → reset to `from`,
   writes `data/update-rolled-back.json` (shown on the page). Logs "update guard: …".
5. `main.js` calls `markHealthy()` 60 s after "waiting for rings and motion" → deletes
   update.json, logs "update to <sha> is working".

Only works when `DOORBELL_SUPERVISED=1` (set by start-doorbell.bat); otherwise it updates but
doesn't restart.

## Git as SYSTEM
The folder belongs to the user, the recorder runs as SYSTEM → git needs
`-c safe.directory=<APP_DIR>` (done in `git()`); git path prefers `C:\Program Files\Git\cmd\git.exe`.
npm runs via `npm.cmd` with `shell: true`, fixed args only.

## Timing (laptop)
check ≈ few s; apply ≈ 50 s (install ~5 s, tests ~45 s); restart ≈ 20 s; healthy +60 s.
The HTTP request stays open during apply; tailscale serve does not time it out.

## Debugging a failed update
`grep -hiE "update|restart|rolled|guard" logs/recorder-*.log | tail -20`. The lines after
"Details:" name the failing tests. If tests pass by hand but fail in an update, suspect the
recorder's environment (it differs from a shell: SYSTEM user, `.env` values in process.env,
DOORBELL_SUPERVISED). See history.md 2026-11-12.

## End-to-end test
Push a harmless commit (e.g. docs) from a temp clone so the laptop is behind, ask the owner to
tap Update & restart, watch the log for: updated → restarting → update guard → recorder started
→ "is working".
