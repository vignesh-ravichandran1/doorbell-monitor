# History: incidents and decisions (newest first, one or two lines each)

- 2026-11-12 Restart after an update was logged as "ended without a clean stop"; onRestart now
  stops via `lifecycle.stop()` with a reason (03386b9).
- 2026-11-12 Every phone update was undone ("failed its checks"): the recorder's process.env held
  `.env` values, inherited by `npm test`, so settings.test failed. Fixed by stripping ENV_KEYS in
  test.mjs; full failure details now logged; update-guard logs to logs/ (2c8aba8). Verified end
  to end from the phone.
- 2026-11-12 Clips lost their last 1–2 s on Windows (ffmpeg killed outright, fragments only at
  keyframes): fragments every 0.5 s + 1 s extra (ec16ce1). Same commit: tests stop reading `.env`.
- 2026-11-08 Recorder moved from the Startup folder to a SYSTEM boot task so it survives Windows
  Update restarts and runs before sign-in (1a0bee8).
