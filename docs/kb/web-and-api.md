# Clips page and HTTP API (src/server.js, src/web/index.html)

Served on WEB_PORT (default 8080). Remote access is via `tailscale serve` (https), which adds
the `Tailscale-User-Login` header; `who(req)` logs that + the address. Requests straight on the
LAN (e.g. 192.168.x.x) have no Tailscale user.

## Routes
| Route | Auth | Notes |
|---|---|---|
| `/`, `/index.html` | none | the page |
| `GET /api/clips`, clip files | none | Range requests supported |
| `POST /api/login` | PIN | sets `doorbell_session` cookie |
| `/api/auth/status`, `/api/logout` | — | |
| `/api/passkey/login-options`, `/api/passkey/login` | none | Face ID unlock |
| `/api/settings`, `/api/clips/delete` | session | |
| `/api/passkeys`, `/api/passkey/register(-options)`, `/api/passkey/remove` | session | |
| `/api/update/status`, `check`, `apply` | session | see updates.md |

Auth: `settings.Sessions` (TTL, lockout after repeated wrong PINs). PIN hash in `.env`
(`SETTINGS_PIN_HASH`, set via `npm run pin`). Passkeys are tied to the rpID (hostname) they
were made on; the PIN works everywhere.

## Settings
`settings.FIELDS` lists what the page can edit; `live: true` ones update `config` at once,
others (RECORDINGS_PATH, WEB_PORT) need a restart (`pendingRestart`). Saved to `.env` with
`updateEnvText` (keeps comments). Adding a setting: FIELDS + `config.js` (`config` and `ENV_KEYS`)
+ `.env.example` + the page.

## The page
Single file, no framework. Grep for the section id (`settings-view`, etc.) instead of reading it.
Phones are the main client: full-screen landscape player, works with rotation lock on.
