# Tests

- `npm test` → `scripts/test.mjs` → `node --test --test-reporter=tap` over `test/*.test.js`,
  then a short "FAILED: name -- error" summary on stderr (the phone shows the last lines).
- ~45 s, ~40 tests. Slow ones: recorder (fake doorbell with real ffmpeg), thumbnail (real clip),
  updater (throwaway git repos in the OS temp folder).
- Tests must not depend on this computer: test.mjs sets `DOORBELL_IGNORE_ENV_FILE=1` and removes
  every `config.ENV_KEYS` variable from the environment. A test fails if src/ reads a setting
  that isn't in ENV_KEYS, so add new settings there.
- The updater runs `npm test` from inside the recorder (as SYSTEM, with .env loaded): a test that
  passes in a shell can still fail there. To reproduce: run `npm test` with settings set in the
  environment, e.g. `WEB_PORT=8099 RECORD_ON=ding npm test`.
- Tests that set `process.env` must delete what they set (see settings.test.js).
- Single file: `node --test test/storage.test.js`.
- Style: node:test + node:assert/strict, temp dirs via `fs.mkdtempSync(os.tmpdir())`, no mocks
  library; updater tests import a copied updater.js with `?random` to get a fresh module.
