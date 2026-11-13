# Windows deployment (the always-on laptop)

- Scheduled task **"Doorbell recorder"** (created by `windows/start-at-boot.bat` → `boot-task.ps1`,
  needs admin): runs `cmd.exe /c windows\start-doorbell.bat` as **SYSTEM** at boot, no time limit,
  restarts on failure. Re-running start-at-boot.bat restarts the recorder.
- `start-doorbell.bat`: sets DOORBELL_SUPERVISED=1, loop: update-guard → main.js; exit 3 ends the
  loop, anything else restarts after 10 s.
- Stop cleanly: `windows\stop-recorder.bat` (drops `logs/stop-request`; recorder exits 3).
- Watch the log: `windows\watch-log.bat`. Nobody sees the SYSTEM console, so anything worth
  knowing must go to `logs/` (console.log is mirrored there once `startFileLog` ran).
- `windows/always-on.bat` (admin, one-time): on AC no sleep/hibernate/disk spin-down, lid close
  does nothing, USB selective suspend off (external clip disk).
- Clips page reached remotely through `tailscale serve` (https), which passkeys need.

## Working on the laptop as Claude
- The shell is a non-elevated admin (UAC-filtered): `Get-ScheduledTask "Doorbell recorder"` and
  `schtasks /query` give Access denied; SYSTEM processes show no command line.
- Is the recorder up? `cat logs/state.json` (pid, lastAlive updated every 30 s) and the log tail.
- **Run something as SYSTEM**: write a .bat that writes its output to a folder, plus an
  elevated .ps1 that registers a temporary task (`-User SYSTEM`), starts it, waits for a
  done-file and unregisters it; launch with
  `Start-Process powershell -Verb RunAs -ArgumentList '-File',...` (owner approves UAC).
  SYSTEM has: TEMP=C:\WINDOWS\TEMP, npm cache in systemprofile, node + git on PATH, no ffmpeg on
  PATH (the app uses the bundled one).
- Code changes on disk only take effect at the next restart. **Restart** (≈15 s gap): an elevated
  .ps1 (launched with RunAs as above) that writes `logs\stop-request`, waits until
  `(Get-ScheduledTask 'Doorbell recorder').State` is no longer Running (clean exit 3), then
  `Start-ScheduledTask 'Doorbell recorder'`. Check the log for "recorder started" + "waiting for rings".
