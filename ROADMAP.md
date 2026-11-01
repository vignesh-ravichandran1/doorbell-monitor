# Roadmap

Ideas for later, roughly in priority order.

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
