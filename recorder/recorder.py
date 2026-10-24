"""Record Ring doorbell clips locally and push phone notifications.

Listens to ring-mqtt for ding/motion events. On each event it:
  1. sends an instant notification (ntfy) so the phone buzzes right away,
  2. records a clip from the doorbell's live RTSP stream to the hard disk,
  3. sends a second notification with a snapshot that links to the clip,
  4. prunes old clips and rebuilds the browse page (index.html).
"""

import datetime as dt
import html
import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import paho.mqtt.client as mqtt
import requests

log = logging.getLogger("recorder")


def env_list(name, default):
    return {v.strip() for v in os.environ.get(name, default).split(",") if v.strip()}


MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
RTSP_HOST = os.environ.get("RTSP_HOST", "localhost")
RTSP_PORT = int(os.environ.get("RTSP_PORT", "8554"))
RTSP_USER = os.environ.get("LIVESTREAM_USER", "")
RTSP_PASS = os.environ.get("LIVESTREAM_PASS", "")
RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR", "./recordings"))
RECORD_SECONDS = int(os.environ.get("RECORD_SECONDS", "30"))
RECORD_ON = env_list("RECORD_ON", "ding,motion")
NOTIFY_ON = env_list("NOTIFY_ON", "ding,motion")
MOTION_COOLDOWN = int(os.environ.get("MOTION_COOLDOWN_SECONDS", "120"))
KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "30"))
MIN_FREE_GB = float(os.environ.get("MIN_FREE_GB", "10"))
NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "")
NTFY_TOKEN = os.environ.get("NTFY_TOKEN", "")
WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "").rstrip("/")
CAMERA_NAME = os.environ.get("CAMERA_NAME", "Front door")

EVENTS = ("ding", "motion")
TITLES = {"ding": "Someone rang the doorbell", "motion": "Motion at the door"}


def parse_topic(topic, payload):
    """Return (device_id, event) for an event-start message, else None.

    ring-mqtt topics look like: ring/<location_id>/camera/<device_id>/ding/state
    """
    parts = topic.split("/")
    if len(parts) != 6 or parts[0] != "ring" or parts[2] != "camera" or parts[5] != "state":
        return None
    if parts[4] not in EVENTS or payload.strip().upper() != "ON":
        return None
    return parts[3], parts[4]


def rtsp_url(device_id):
    auth = f"{RTSP_USER}:{RTSP_PASS}@" if RTSP_USER else ""
    return f"rtsp://{auth}{RTSP_HOST}:{RTSP_PORT}/{device_id}_live"


def notify(title, message, priority="default", image=None, click=None):
    if not NTFY_TOPIC:
        return
    headers = {"Title": title, "Priority": priority, "Tags": "door"}
    if NTFY_TOKEN:
        headers["Authorization"] = f"Bearer {NTFY_TOKEN}"
    if click:
        headers["Click"] = click
    url = f"{NTFY_URL}/{NTFY_TOPIC}"
    try:
        if image and image.exists():
            headers["Message"] = message
            headers["Filename"] = image.name
            requests.put(url, data=image.read_bytes(), headers=headers, timeout=20)
        else:
            requests.post(url, data=message.encode(), headers=headers, timeout=20)
    except requests.RequestException as e:
        log.warning("notification failed: %s", e)


def record_clip(device_id, out_path):
    """Record RECORD_SECONDS from the live stream. Returns True on success."""
    tmp = out_path.with_suffix(".part")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-rtsp_transport", "tcp", "-timeout", "20000000",
        "-i", rtsp_url(device_id),
        "-t", str(RECORD_SECONDS),
        "-map", "0:v", "-map", "0:a?",
        "-c:v", "copy", "-c:a", "aac",
        "-movflags", "+faststart", "-f", "mp4", str(tmp),
    ]
    try:
        subprocess.run(cmd, check=True, timeout=RECORD_SECONDS + 90,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        log.error("ffmpeg failed for %s: %s", device_id, e.stderr.decode(errors="replace").strip())
    except subprocess.TimeoutExpired:
        log.error("ffmpeg timed out for %s", device_id)
    if tmp.exists() and tmp.stat().st_size > 10_000:
        tmp.rename(out_path)
        return True
    tmp.unlink(missing_ok=True)
    return False


def make_thumbnail(clip, thumb):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "2", "-i", str(clip),
         "-frames:v", "1", "-vf", "scale=640:-2", str(thumb)],
        timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return thumb.exists()


def prune(root=None, keep_days=None, min_free_gb=None, now=None):
    """Delete clips older than keep_days, then oldest-first until min_free_gb is free."""
    root = Path(root or RECORDINGS_DIR)
    keep_days = KEEP_DAYS if keep_days is None else keep_days
    min_free_gb = MIN_FREE_GB if min_free_gb is None else min_free_gb
    today = (now or dt.datetime.now()).date()

    day_dirs = sorted(d for d in root.iterdir() if d.is_dir() and is_day_dir(d.name))
    for d in day_dirs:
        if (today - dt.date.fromisoformat(d.name)).days > keep_days:
            log.info("pruning %s (older than %d days)", d.name, keep_days)
            shutil.rmtree(d)

    clips = sorted(root.glob("*/*.mp4"))
    while clips and shutil.disk_usage(root).free < min_free_gb * 1024**3:
        oldest = clips.pop(0)
        log.info("pruning %s (disk low)", oldest)
        oldest.unlink(missing_ok=True)
        oldest.with_suffix(".jpg").unlink(missing_ok=True)

    for d in root.iterdir():
        if d.is_dir() and is_day_dir(d.name) and not any(d.iterdir()):
            d.rmdir()


def is_day_dir(name):
    try:
        dt.date.fromisoformat(name)
        return True
    except ValueError:
        return False


def write_index(root=None):
    """Write a phone-friendly page listing every clip, newest first."""
    root = Path(root or RECORDINGS_DIR)
    clips = sorted(root.glob("*/*.mp4"), reverse=True)
    rows = []
    current_day = None
    for clip in clips:
        day = clip.parent.name
        if day != current_day:
            rows.append(f"<h2>{html.escape(day)}</h2>")
            current_day = day
        rel = f"{day}/{clip.name}"
        hhmmss, event = clip.stem.split("_")[:2]
        label = f"{hhmmss[:2]}:{hhmmss[2:4]}:{hhmmss[4:6]} &middot; {html.escape(event)}"
        poster = f' poster="{day}/{clip.with_suffix(".jpg").name}"' if clip.with_suffix(".jpg").exists() else ""
        rows.append(
            f'<figure><video controls preload="none"{poster} src="{rel}"></video>'
            f'<figcaption>{label} &middot; <a href="{rel}" download>download</a></figcaption></figure>'
        )
    body = "\n".join(rows) or "<p>No recordings yet.</p>"
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doorbell Recordings</title>
<style>
:root {{ color-scheme: light dark; --bg:#fafafa; --fg:#111; --muted:#666; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#111; --fg:#eee; --muted:#999; }} }}
body {{ margin:0 auto; padding:16px; max-width:720px; font-family:system-ui,sans-serif; background:var(--bg); color:var(--fg); }}
h2 {{ font-size:1rem; color:var(--muted); margin:24px 0 8px; }}
figure {{ margin:0 0 16px; }}
video {{ width:100%; border-radius:8px; background:#000; }}
figcaption {{ font-size:.9rem; color:var(--muted); padding-top:4px; }}
a {{ color:inherit; }}
</style></head><body>
<h1>Doorbell recordings</h1>
{body}
</body></html>
"""
    tmp = root / "index.html.part"
    tmp.write_text(page)
    tmp.replace(root / "index.html")


class Recorder:
    def __init__(self):
        self.busy = set()
        self.last_motion_notify = {}
        self.lock = threading.Lock()

    def handle(self, device_id, event):
        log.info("%s event from %s", event, device_id)
        if event in NOTIFY_ON and self._should_notify(device_id, event):
            notify(f"{CAMERA_NAME}: {TITLES[event]}",
                   f"{dt.datetime.now():%H:%M:%S} - clip recording now",
                   priority="high" if event == "ding" else "default",
                   click=WEB_BASE_URL or None)
        if event in RECORD_ON:
            with self.lock:
                if device_id in self.busy:
                    return  # already recording this camera; the current clip covers it
                self.busy.add(device_id)
            threading.Thread(target=self._record, args=(device_id, event), daemon=True).start()

    def _should_notify(self, device_id, event):
        if event == "ding":
            return True
        now = time.monotonic()
        last = self.last_motion_notify.get(device_id)
        if last is not None and now - last < MOTION_COOLDOWN:
            return False
        self.last_motion_notify[device_id] = now
        return True

    def _record(self, device_id, event):
        try:
            started = dt.datetime.now()
            day_dir = RECORDINGS_DIR / f"{started:%Y-%m-%d}"
            day_dir.mkdir(parents=True, exist_ok=True)
            clip = day_dir / f"{started:%H%M%S}_{event}_{device_id}.mp4"
            if not record_clip(device_id, clip):
                notify(f"{CAMERA_NAME}: recording failed",
                       "Could not record from the doorbell stream. Check `docker compose logs`.",
                       priority="low")
                return
            thumb = clip.with_suffix(".jpg")
            make_thumbnail(clip, thumb)
            log.info("saved %s", clip)
            if event in NOTIFY_ON:
                link = f"{WEB_BASE_URL}/{day_dir.name}/{clip.name}" if WEB_BASE_URL else None
                notify(f"{CAMERA_NAME}: clip saved ({event})", f"{started:%a %H:%M:%S}",
                       priority="low", image=thumb, click=link)
            prune()
            write_index()
        except Exception:
            log.exception("recording %s failed", device_id)
        finally:
            with self.lock:
                self.busy.discard(device_id)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    prune()
    write_index()
    recorder = Recorder()

    def on_connect(client, userdata, flags, reason_code, properties):
        log.info("connected to MQTT (%s)", reason_code)
        for event in EVENTS:
            client.subscribe(f"ring/+/camera/+/{event}/state")

    def on_message(client, userdata, msg):
        parsed = parse_topic(msg.topic, msg.payload.decode(errors="replace"))
        if parsed:
            recorder.handle(*parsed)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="doorbell-recorder")
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            break
        except OSError as e:
            log.warning("MQTT not reachable yet (%s), retrying", e)
            time.sleep(5)

    def housekeeping():
        while True:
            time.sleep(3600)
            try:
                prune()
                write_index()
            except Exception:
                log.exception("housekeeping failed")

    threading.Thread(target=housekeeping, daemon=True).start()
    client.loop_forever(retry_first_connection=True)


if __name__ == "__main__":
    main()
