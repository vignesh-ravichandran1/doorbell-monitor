# doorbell-monitor

Use your Ring doorbell **without a Ring Protect subscription**. An old laptop at home:

- buzzes your phone the moment someone rings or motion is detected,
- records a 30-second clip of every event to your external hard disk,
- sends a second notification with a snapshot that opens the clip,
- serves a simple web page (works on phones) to browse and play every clip,
- deletes old clips automatically so the disk never fills up.

Nothing leaves your house except the Ring login and the notification text and image (sent through [ntfy](https://ntfy.sh)).

```
Ring doorbell ──(Ring cloud, free live view)──> ring-mqtt ──RTSP──> recorder ──> external HDD
                                                    │                  │
                                                    └──MQTT events─────┘──> ntfy ──> your phone
                                                                         web page :8080 <── phone/PC at home
```

## Which laptop

Use the **2010 Dell Inspiron (i3)** and leave your wife's 2013 laptop alone. This setup only copies video and doesn't analyse it, so an old i3 with 2–4 GB RAM is plenty. A dead battery is fine because it stays plugged in. Connect it to the Bell Home Hub **with an Ethernet cable** if you can, since that's much more reliable than old laptop Wi-Fi.

> Why not Frigate (the popular suggestion)? Frigate's person/package detection needs a modern CPU or a Coral accelerator. On a 2010 i3 it would run near 100% CPU and lag. This project skips AI detection and relies on Ring's own motion events, which cost nothing to process.

## Setup (about 30–45 minutes)

### 1. Install Linux on the old laptop
1. On another computer, download **Ubuntu Server 24.04 LTS** (or Debian 12), write it to a USB stick with [balenaEtcher](https://etcher.balena.io/), and boot the Dell from it (press **F12** at the Dell logo).
2. Install it, wiping Windows. Tick **Install OpenSSH server** and pick a username and password.
3. In the BIOS (**F2** at boot), set *AC Power Recovery* / *Power On with AC* to **On** if it exists. The laptop then restarts by itself after a power cut.

### 2. Give the laptop a fixed IP on the Bell Home Hub
1. Open `http://192.168.2.1` and log in with the admin password printed on the Home Hub's sticker.
2. Go to **Advanced Tools and Settings → DHCP** (the name varies by Home Hub model), find the laptop, and **reserve** its IP address (for example `192.168.2.50`).
3. **Don't forward any ports.** Nothing here should be reachable from the internet.

### 3. Prep the laptop and the hard disk
Plug in the external hard disk and SSH in from any computer: `ssh you@192.168.2.50`.

```bash
sudo apt install -y git
git clone https://github.com/vignesh-ravichandran1/doorbell-monitor.git
cd doorbell-monitor
lsblk -f                                    # find your disk's partition, e.g. sdb1
sudo ./scripts/setup-laptop.sh /dev/sdb1    # installs Docker, ignores lid close, mounts disk at /mnt/doorbell
exit                                        # log back in so the docker group applies
```

The script **never formats** the disk. It mounts the partition you name, whether NTFS, exFAT or ext4, and existing files on it are left alone. Clips go into dated folders such as `2026-10-24/`. You can now close the lid.

### 4. Configure and start
```bash
cd doorbell-monitor
./scripts/configure.sh      # creates .env + ring-mqtt/config.json with random passwords
nano .env                   # optional: CAMERA_NAME, RECORD_SECONDS, KEEP_DAYS ...
docker compose up -d
```

### 5. Log in to Ring (one time)
Open **http://192.168.2.50:55123** in a browser and sign in with your Ring account and 2FA code. ring-mqtt saves a token and never asks again. Then check the logs:
```bash
docker compose logs -f ring-mqtt recorder
```

### 6. Get notifications on your phone
1. Install **ntfy** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iPhone](https://apps.apple.com/app/ntfy/id1625396347)).
2. Tap **+** and subscribe to the topic that `configure.sh` printed (`grep NTFY_TOPIC .env`).
3. Press your doorbell. You should get an instant alert, and about 40 seconds later a second alert with a snapshot. Tapping that one opens the clip (only while you're on home Wi-Fi, see below).

### 7. Watch clips
Open **http://192.168.2.50:8080** on any phone or computer at home.

## Watching clips when you're away (optional)
Install [Tailscale](https://tailscale.com) (free) on the laptop (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`) and on your phone. Then set `WEB_BASE_URL=http://<laptop's tailscale IP>:8080` in `.env` and run `docker compose up -d`. Notification links and the web page now work from anywhere, still without forwarding any ports.

## Settings (`.env`)
| Setting | Default | Meaning |
|---|---|---|
| `RECORD_ON` | `ding,motion` | Events that record a clip |
| `NOTIFY_ON` | `ding,motion` | Events that notify your phone |
| `MOTION_COOLDOWN_SECONDS` | `120` | At most one motion alert per this many seconds (a ring always alerts) |
| `RECORD_SECONDS` | `30` | Clip length |
| `KEEP_DAYS` | `30` | Delete clips older than this |
| `MIN_FREE_GB` | `10` | Delete the oldest clips when free disk space drops below this |

After editing, run `docker compose up -d` to apply.

## Things to know
- **Clips start about 3–8 seconds after the event.** Without a subscription Ring keeps no pre-roll, so the clip starts once the live view connects. For a doorbell this usually still catches the person standing there.
- **Battery-powered Ring doorbells:** each clip is a live-view session, so recording on every motion drains the battery faster. On a battery model, set `RECORD_ON=ding` and `NOTIFY_ON=ding`, or turn down motion sensitivity in the Ring app. Wired doorbells don't have this problem.
- The Ring app keeps working as before: live view, two-way talk, and its own notifications. You can turn off Ring's notifications if you get double alerts.
- This uses Ring's unofficial API through [ring-mqtt](https://github.com/tsightler/ring-mqtt). If Ring changes something, run `docker compose pull && docker compose up -d` to get fixes.
- 1 TB holds months of 30-second clips (about 5–15 MB each).

## Maintenance
```bash
docker compose logs --tail 50 recorder   # what happened recently
docker compose pull && docker compose up -d --build   # update everything
df -h /mnt/doorbell                       # disk space
```

## Development
```bash
cd recorder && pip install -r requirements.txt pytest && pytest -q
```
