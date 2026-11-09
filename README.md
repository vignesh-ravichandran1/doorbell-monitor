# doorbell-monitor

Record every ring and motion event from your Ring doorbell **without a Ring Protect subscription**.
It's one small Node.js program, with no Docker. It runs on **macOS, Windows 10/11 and Linux**, including old laptops.

- Records each ring (60 s) and motion event (30 s) from Ring's free live view. If activity continues, the same clip keeps recording, up to 2 minutes.
- Keeps as many clips as fit: the oldest are deleted only when the space you set (default **20 GB**) is full.
- Clips page for any phone or computer on your home Wi-Fi (`http://<computer-ip>:8080`), or anywhere through Tailscale: newest first, filters by day and by rings vs. motion, a storage meter, and a PIN-protected **Settings** tab.
- Thumbnails show what happened: the visitor at the moment of the ring, or the most eventful frame of a motion clip.
- Runs 24/7 on an old Windows laptop: starts at boot **without anyone signing in**, survives Windows Update restarts and power cuts, and logs why any gap in recording happened.
- Optional phone alerts through [ntfy](https://ntfy.sh). Off by default, since the Ring app already alerts you.

Planned features are in [ROADMAP.md](ROADMAP.md), such as keeping important clips forever.

## Requirements
- **Node.js 22 or newer.** The prepare step installs it for you, and ffmpeg comes bundled.
- About 150 MB of memory. Any laptop from 2010 onwards is fine.
- **Windows 10 or 11, macOS 11+ or any current Linux.** Windows 7 and 8 can't run Node.js 22 (or any current runtime). On such a laptop, install a free, lightweight Linux such as [Linux Mint XFCE](https://linuxmint.com) or [Lubuntu](https://lubuntu.me).

## Get started
**Step-by-step guide for Mac and Windows: [SETUP.md](SETUP.md)**

| Step | Mac / Linux | Windows |
|---|---|---|
| 1. Prepare (checks the computer, installs what's missing) | `bash prepare.sh` | double-click `prepare.bat` |
| 2. Setup (Ring login, settings, optional 24/7 auto-start) | `npm run setup` | `npm run setup` |
| 3. Run | `npm start` | `npm start` |

Check everything at any time with `npm run doctor`.

Your Ring email and password go only to Ring. Only a login token is kept, in `.ring-token` on that computer. It and your `.env` settings are never uploaded. Each computer (Mac for testing, laptop for 24/7) gets its own login and settings.

## The clips page
Open `http://localhost:8080` on the recording computer, or `http://<its IP>:8080` from a phone on the same Wi-Fi.
- **Clips:** thumbnails, newest first, under day headings, with 12-hour times. Filter by All / Today / Yesterday / Last 7 days / a picked date, and by All events / Rings / Motion. Tap a clip to play it; use **Newer / Older** to step through, and **Download** to save it.
- **Thumbnails:** for a ring, the best frame in the 5 seconds after the ring (the visitor at the door). For motion, the frame that differs most from the empty scene, skipping blurry ones. Picking it takes about 2 seconds of CPU per clip, at low priority. `npm run rethumb` redoes the thumbnails of clips recorded before this existed.
- **Fast to play, even over Tailscale:** once a clip is saved it's rewritten (no re-encoding) with its index at the front, so phones show its length and jump anywhere at once. Clips you've already watched aren't downloaded again unless they changed.
- **Storage meter:** how much of your space is used and how many clips you have.
- **Settings:** see below.
- **iPhone:** in Safari, **Share → Add to Home Screen** to open it like an app.

## Settings
Open the clips page → **Settings** tab, and unlock it with your PIN (set during `npm run setup`, change it any time with `npm run pin`). Storage, recording and alert settings apply immediately; the clips folder and port apply after a restart. Everything is saved in `.env`, which you can also edit by hand.

| Setting (`.env`) | Default | Meaning |
|---|---|---|
| `RECORDINGS_PATH` | `recordings` | Where clips go, e.g. `E:/doorbell` for an external disk on Windows |
| `MAX_STORAGE_GB` | `20` | Space for all clips; the oldest are deleted only when it's full (`0` = no cap) |
| `MIN_FREE_GB` | `5` | Also purge if the disk itself gets this low |
| `KEEP_DAYS` | `0` (off) | Optional: also delete clips older than this many days |
| `RECORD_SECONDS_DING` | `60` | Length of clips that start with a ring |
| `RECORD_SECONDS_MOTION` | `30` | Length of clips that start with motion |
| `MAX_CLIP_SECONDS` | `120` | New rings/motion during a clip extend it, up to this length |
| `RECORD_ON` | `ding,motion` | Events that record a clip |
| `NOTIFY_ON` | *(empty = off)* | Events that send an ntfy alert (`ding`, `motion`) |
| `NTFY_TOPIC` | *(empty)* | Your ntfy topic; long and random, it acts as a password |
| `MOTION_COOLDOWN_SECONDS` | `120` | At most one motion alert per this many seconds |
| `WEB_BASE_URL` | *(empty)* | This page's address (e.g. the Tailscale one), so alert links open clips |
| `WEB_PORT` | `8080` | The page's port (restart needed) |
| `SETTINGS_PIN_HASH` | *(set by `npm run pin`)* | Protects the Settings tab; stored as a hash, never the PIN |

Purging runs after every clip and once an hour. If you edit `.env` by hand, restart the app.

## Running 24/7 on Windows
`npm run setup` (answer **y** to "Is this the one that will record 24/7?") or `windows\start-at-boot.bat` sets this up. Both ask for admin once.

- **Boot task:** a scheduled task, **Doorbell recorder**, runs `windows\start-doorbell.bat` as SYSTEM at every boot (30 s after start-up, for Wi-Fi). Nobody has to sign in, and no password is stored. The task has no time limit, runs on battery and restarts if it fails. The batch file restarts the recorder 10 seconds after it stops.
- **Fast Startup is turned off**, because otherwise "Shut down" is really hibernation and the boot task never runs. The old start-at-sign-in shortcut is removed.
- **One recorder per computer.** A second copy would knock the first off Ring's push connection, so it logs why and exits.
- **No window:** it runs in the background, so use these files in the `windows` folder:

  | File | What it does |
  |---|---|
  | `watch-log.bat` | Shows the live log. Closing it doesn't stop the recorder |
  | `stop-recorder.bat` | Stops it cleanly, and the stop is logged |
  | `start-at-boot.bat` | Starts or restarts it, e.g. after updating the code. Also re-creates the boot task |
  | `always-on.bat` | Never sleep on mains power (lid closed too), keep the USB disk and Wi-Fi powered, Private network, firewall rule for the clips page (home network and Tailscale only) |

- **Logs:** `logs\recorder-YYYY-MM-DD.log`, kept 30 days, plus `logs\state.json`. Each start notes when the laptop booted and how the previous run ended (clean stop, crash, restart, power cut). While running, it notes any time the laptop was asleep or the recorder stalled, so every gap in recording is explained.
- **Old hard disks:** while Windows Update installs, a laptop hard disk can be 100% busy for hours. The recorder never waits on the disk for logging or for the clips page, so it keeps recording and stays connected to Ring. Clips may still load slowly until the update finishes. An SSD fixes this for good.

## Watching clips when you're away (optional)
Use [Tailscale](https://tailscale.com) (free): install it on the recording computer and your iPhone, and sign in to both with the same account. Then open `http://<computer's 100.x.y.z address>:8080` from anywhere. It stays private and no ports are opened. On Windows, turn on **Run unattended** in Tailscale's Preferences (or run `tailscale up --unattended`), so Tailscale stays connected while nobody is signed in. With Tailscale left on, the 100.x address also works at home, so you need only one bookmark. **Step-by-step: [SETUP.md → Tailscale](SETUP.md#watch-from-anywhere-with-tailscale-free)**.

## Things to know
- **Clips start about 3–8 seconds after the event.** Without a subscription Ring keeps no pre-roll, so the clip starts once live view connects.
- **Battery doorbells:** each clip is a live-view session, which uses battery. On a battery model, set `RECORD_ON=ding`.
- The Ring app works exactly as before: live view, talk and alerts.
- This uses Ring's unofficial API through [ring-client-api](https://github.com/dgreif/ring). If Ring changes something, update (see above).
- A 30-second clip is about 5–15 MB, so 20 GB holds roughly 1,500–4,000 clips.
- **Problems?** See [SETUP.md → Troubleshooting](SETUP.md#troubleshooting). `npm run doctor` checks everything, and `npm run debug` shows every event Ring sends.

## Commands
| Command | What it does |
|---|---|
| `bash prepare.sh` / `prepare.bat` | Check the computer, install Node.js and the app |
| `npm run setup` | Ring login, settings, PIN, optional 24/7 auto-start |
| `npm start` | Run the recorder |
| `npm run debug` | Run with detailed Ring logging |
| `npm run doctor` | Check everything and explain fixes |
| `npm run test-clip` | With the recorder stopped: record a 15 s test clip, then check that rings reach this computer |
| `npm run rethumb` | Redo the thumbnails of existing clips (safe while the recorder runs) |
| `npm run login` | Log in to Ring again |
| `npm run pin` | Set or change the Settings PIN |
| `windows\start-at-boot.bat` | Windows: start or restart the recorder, and start it at every boot |
| `windows\stop-recorder.bat` | Windows: stop the recorder |
| `windows\watch-log.bat` | Windows: watch the log |

## Development
```
npm test
```
