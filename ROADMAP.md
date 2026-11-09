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
  150 MB of RAM while running. **Measure on real clips before building the rest.**
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

## Done: thumbnails that show what happened (2026-11-09)
Ring clips use the best frame in the 5 s after the ring. Motion clips use the frame most
different from the empty scene, taken as the per-pixel median of the clip's last quarter, and
skip blurry frames. `npm run rethumb` covers old clips. Ideas to improve it:
- On real clips where someone stays in view the whole time (e.g. unloading a car), it does no
  better than the old 2 s frame. Detection fixes that.
- No real ring clips had been checked when it shipped. Look at the first few.

# Later

## Never purge significant events
Right now purging is purely by age (`KEEP_DAYS`) and size (`MAX_STORAGE_GB`, `MIN_FREE_GB`), oldest first.
Significant clips should be kept no matter what.

- **Cheap first step (no AI):** a "Keep" button on the web page that moves a clip into a
  `keep/` folder that the purger never touches. Doorbell *rings* could also be kept longer
  than motion, e.g. with a separate `KEEP_DAYS_DING`.
- **Automatic detection:** run a small person/package detector (e.g. YOLO-nano or MobileNet SSD
  via OpenCV) on a few frames of each clip *after* it is saved, not live, so even the 2010 i3
  can keep up. Tag clips (`person`, `package`, `vehicle`) and protect tagged ones from purging.
  Package delivered then gone later = possible theft, so flag it.
- Protected clips should still count toward a separate cap so they can't fill the disk.

## Upload to Google Drive (or Google Photos)
Copy each clip to a `Doorbell` folder in Google Drive (e.g. with rclone), apply the same retention there,
and watch clips from anywhere in the Drive app. Photos is possible but can't auto-delete.

## Other
- Pre-roll: keep the live stream open continuously on wired doorbells, so clips include the
  seconds before the event (costs bandwidth, so make it optional).
- Daily summary notification (number of rings and motion events, thumbnails).
