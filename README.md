# doorbell-monitor

Record every ring and motion event from your Ring doorbell **without a Ring Protect subscription**.
It's one small Node.js program, with no Docker. It runs on **macOS, Windows 10/11 and Linux**, including old laptops.

- Records a 30-second clip of each ring and motion event from Ring's free live view.
- Purges old clips automatically by age (default **14 days**) and by total size (default **20 GB**).
- Serves a page to watch clips from any phone or computer on your home Wi-Fi: `http://<computer-ip>:8080`.
- Optional phone alerts through [ntfy](https://ntfy.sh). Off by default, since the Ring app already alerts you.

Planned features are in [ROADMAP.md](ROADMAP.md), such as keeping important clips forever.

## Requirements
- **Node.js 22 LTS or newer** ([nodejs.org](https://nodejs.org)). It bundles its own ffmpeg, so there's nothing else to install.
- About 150 MB of memory. Any laptop from 2010 onwards is fine.
- **Windows 10 or 11, macOS 11+ or any current Linux.** Windows 7 and 8 can't run Node.js 22 (or any current runtime). On such a laptop, install a free, lightweight Linux such as [Linux Mint XFCE](https://linuxmint.com) or [Lubuntu](https://lubuntu.me).

## Your Ring login stays on your computer
`npm run login` runs Ring's own sign-in **in your terminal**. You type your email, password and 2-step code there, and they go only to Ring. You get back a token, which is stored in `.env` / `.ring-token` on that computer. Both files are git-ignored, so they never reach GitHub or anyone else.

To cut access at any time, open the Ring app → **Control Center → Authorized Client Devices** and remove the device.

## Two environments: test (Mac) and production (laptop)
Each computer is its own environment, with its own `.env` file and its own Ring login. Don't copy `.env` between computers: Ring replaces the token regularly, and the copy on the other machine stops working. Run `npm run login` on each computer instead. Use different settings per machine as you like, for example `KEEP_DAYS=2` and `MAX_STORAGE_GB=2` on the Mac.

## Install (the same on every computer)
1. Install **Node.js 22 LTS** from [nodejs.org](https://nodejs.org) using the normal installer.
2. Get the code. Either download it from GitHub (**Code → Download ZIP**, then unzip), or run:
   ```
   git clone https://github.com/vignesh-ravichandran1/doorbell-monitor.git
   ```
3. Open a terminal in that folder. On Windows, open the folder in File Explorer, type `cmd` in the address bar and press Enter. Then run:
   ```
   npm install
   npm run login
   ```
4. Copy `.env.example` to a new file named `.env`. Paste the token from step 3 after `RING_REFRESH_TOKEN=` and adjust any settings.
5. Start it:
   ```
   npm start
   ```
   You should see `watching Front Door`. Ring the doorbell, and about 40 seconds later the clip is at **http://localhost:8080**.

## Keep it running

**Mac (testing):** The Mac must stay awake, because recording stops when it sleeps or the lid closes. Run `caffeinate -i npm start` and keep the Mac plugged in. Stop it with Ctrl+C.

**Windows laptop (24/7):** Double-click `windows\setup-windows.bat` once. It stops sleep on mains power, keeps running with the lid closed, and starts the recorder at sign-in. Then double-click `windows\start-doorbell.bat`, or just restart the laptop.
To survive power cuts, also set Windows to sign in automatically (run `netplwiz` and untick *Users must enter a user name and password*). If the BIOS has a *Power on AC* option, turn it on too.

**Linux laptop (24/7):** Edit `linux/doorbell.service` (your username and folder), then:
```
sudo cp linux/doorbell.service /etc/systemd/system/ && sudo systemctl enable --now doorbell
```
Set the lid to do nothing in the power settings, or set `HandleLidSwitch=ignore` in `/etc/systemd/logind.conf`.

**On every machine:** In the Bell Home Hub (`192.168.2.1` → DHCP), reserve the computer's IP address so the clips page address never changes. Don't forward any ports.

## Updating
```
git pull        (or download the ZIP again and keep your .env)
npm install
```
Then restart the app.

## Settings (`.env`)
| Setting | Default | Meaning |
|---|---|---|
| `RECORDINGS_PATH` | `recordings` | Where clips go, e.g. `E:/doorbell` for an external disk on Windows |
| `KEEP_DAYS` | `14` | Delete clips older than this many days |
| `MAX_STORAGE_GB` | `20` | Keep all clips together under this size; the oldest go first (`0` = no cap) |
| `MIN_FREE_GB` | `5` | Also purge if the disk itself gets this low |
| `RECORD_SECONDS` | `30` | Clip length |
| `RECORD_ON` | `ding,motion` | Events that record a clip |
| `NOTIFY_ON` | *(empty = off)* | Events that send an ntfy alert (`ding`, `motion`) |

Purging runs after every clip and once an hour. Restart the app after changing `.env`.

## Watching clips when you're away (optional)
Install [Tailscale](https://tailscale.com) (free) on the laptop and on your iPhone, and sign in to both with the same account. Then open `http://<laptop's Tailscale IP>:8080` from anywhere. It stays private and no ports are opened.

## Things to know
- **Clips start about 3–8 seconds after the event.** Without a subscription Ring keeps no pre-roll, so the clip starts once live view connects.
- **Battery doorbells:** each clip is a live-view session, which uses battery. On a battery model, set `RECORD_ON=ding`.
- The Ring app works exactly as before: live view, talk and alerts.
- This uses Ring's unofficial API through [ring-client-api](https://github.com/dgreif/ring). If Ring changes something, update (see above).
- **If `npm start` shows the clips page line but never shows `watching ...`**, your token has expired. Delete `.ring-token`, run `npm run login` again and update `.env`.
- A 30-second clip is about 5–15 MB, so 20 GB holds roughly 1,500–4,000 clips.

## Development
```
npm test
```
