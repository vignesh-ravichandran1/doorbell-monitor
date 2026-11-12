# Roadmap

Ideas for later, roughly in priority order.

# Next release

## Person / vehicle / animal detection (no Ring Protect needed)
Without a Protect plan Ring only says "motion". Detect on the laptop instead, **after** each clip
is saved and never live, so recording and the Ring push connection are never held up.

- **Engine:** `onnxruntime-node` (no Python) with a small COCO detector. YOLOX-Nano (Apache-2.0)
  is preferred; YOLOv8n / YOLO11n are a bit more accurate but AGPL.
- **Frames:** reuse `sampleFrames()` from `src/thumbnail.js`, but in colour at the model's input
  size. 1 frame every 2 s, one clip at a time, ffmpeg at below-normal priority.
- **Cost (estimate, i7-4700MQ):** 60–120 ms per frame, so 1–2 s of CPU per 30 s clip, and about
  150 MB of RAM while running. **Measure on real clips before building the rest**, including
  night (infrared) clips, where detection is most likely to disappoint.
- **Classes:** person; vehicle = car, truck, bus, motorcycle, bicycle; animal = dog, cat, bird,
  etc. Tag a clip only when the object is seen in at least 2 frames.
- **Storage:** tags go in a sidecar `<clip>.json` (classes, best frame, confidence). Add them to
  `clipSummary()`, with badges (🧍 🚗 🐾) and a filter on the clips page.
- **Thumbnail:** use the frame with the largest, most confident person (or vehicle, or animal) box.
  The current rules in `thumbnail.js` stay as the fallback.
- **Optional alert:** "Person at the door" once the clip is checked, 30–60 s after the event.
- **Backfill:** a one-off background pass over existing clips, like `npm run rethumb`.
- **Limits:** expect misses at night (infrared is greyscale and the lens is fisheye) and for small,
  far-away objects.
- **Leads to:** "never purge significant events" below, so clips with a person are kept.
- **No "package" class:** COCO has no box/parcel class (only backpack, handbag, suitcase), so
  "package delivered, then gone" needs another approach, e.g. watching a doorstep zone for a
  lasting change between clips, or a parcel-trained model.

## Done: thumbnails that show what happened (2026-11-09)
Ring clips use the best frame in the 5 s after the ring. Motion clips use the frame most
different from the empty scene, taken as the per-pixel median of the clip's last quarter, and
skip blurry frames. `npm run rethumb` covers old clips. Ideas to improve it:
- On real clips where someone stays in view the whole time (e.g. unloading a car), it does no
  better than the old 2 s frame. Detection fixes that.
- No real ring clips had been checked when it shipped. Look at the first few.

# Later

## Recorder health on the clips page
Push connection status and the recorder lifecycle go to the log file only. Show them on the page
too, so a silent failure is visible the moment it's opened: connected to Ring or not, last Ring
event, last clip saved, last error. (Two days of missing clips went unnoticed before.)

## Never purge significant events
Purging is size-first: the oldest clips go when `MAX_STORAGE_GB` (or `MIN_FREE_GB`) is reached;
`KEEP_DAYS` is optional and off by default. Significant clips should be kept no matter what.

- **Cheapest first step (no AI):** keep ring clips automatically (a separate pool or cap), since
  a ring nearly always means a visitor.
- **"Keep" button** on the clips page that moves a clip into a `keep/` folder the purger never
  touches.
- **With detection** (see Next release): protect clips tagged person (optionally vehicle).
- Protected clips count toward their own cap so they can't fill the disk.

## Pre-roll: seconds *before* the motion or ring
Today the laptop only opens the doorbell's live view after Ring reports an event, so clips start
3–8 s late and never show what happened just before. (After the event is already covered: clip
lengths, and extension while activity continues.)
- **How:** keep the live view open all the time and hold the last ~10 s in a rolling buffer
  (memory or a few small temp segments, constantly overwritten, so no extra disk use). On an
  event, the clip starts with the buffer, then continues as now.
- **Setting:** "Seconds before the event" (e.g. 10; 0 = off, today's behaviour), live in Settings.
  Wired doorbells only.
- **Costs:** ~1–2 Mbps nonstop (15–20 GB/day of downloads), steady light CPU, a short gap
  without pre-roll whenever Ring ends the live view and it reconnects.
- **Test first (2–3 h, hidden mode):** how long Ring keeps a live view open and the reconnect
  gap; whether ring/motion events still arrive and the Ring app's live view still works while
  streaming; data and CPU per hour; whether Ring objects to nonstop streaming.
- First step towards the continuous-recording option below, which reuses the same stream.

## Continuous recording, middle ground (rolling 24 h buffer + events)
Keep the live view open and write 5–10 minute segments; the last 24 h are kept as a rolling
buffer, event clips are kept long-term in their own pool.
- **Pre-roll:** cut event clips from the buffer so they include ~10 s *before* the ring/motion
  (today every clip starts 3–8 s late).
- **Storage:** about 1.5 Mbps → 15–20 GB/day. Separate caps, e.g. `CONTINUOUS_MAX_GB=20` and the
  existing `MAX_STORAGE_GB=80`, so the stream never pushes event clips out.
- **Modes:** off / night only (e.g. 22:00–06:00) / always. Settings page fields for mode, hours,
  buffer size, pre-roll seconds.
- **Timeline tab:** a 24 h bar per day with recorded stretches and ring/motion markers.
- **Test first (2–3 h hidden mode):** how long Ring keeps a live view open and the reconnect gap;
  whether ring/motion events still arrive and the Ring app's live view still works while
  streaming; CPU and data per hour. Wired doorbells only. Ring may object to 24/7 streaming.

## Blink Mini (window camera) on the same page
The Blink Mini records to a USB stick in the Sync Module 2 (local storage, no subscription).
Log in to Blink's unofficial API (with 2-step verification), poll for new local clips every
minute or so, copy them in, and add a camera filter (Front Door / Window). Blink doesn't push
events like Ring, so clips appear 1–2 min late; no pre-roll or continuous recording.

## Upload to Google Drive (or Google Photos)
Copy each clip to a `Doorbell` folder in Google Drive (e.g. with rclone), apply the same retention there,
and watch clips from anywhere in the Drive app. Photos is possible but can't auto-delete.

## Smooth playback away from home
Over Tailscale (especially when relayed through DERP) full-quality clips can stutter. After each
clip is saved, make a 720p "phone" copy in the background (about a third of the size) and play it
when not on the home network, with a toggle for full quality. Costs ~30% more disk and some CPU.
First check the cheap fix: `tailscale ping` shows "via DERP" → enable UPnP on the router.

## Security: werift / ip
`npm audit` flags `ip` (SSRF in isPublic) via `werift` 0.22, used by ring-client-api for live
view. Not reachable in this app (no untrusted addresses), and `npm audit fix --force` would
downgrade ring-client-api to v9, so don't. `werift` 0.26 drops `ip`: try an npm override to
0.26 and retest recording before shipping it.

## Other
- Daily summary notification (number of rings and motion events, thumbnails).
