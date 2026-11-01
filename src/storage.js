// Clip layout: <recordings>/YYYY-MM-DD/HHMMSS_<event>_<camera>.mp4 (+ .jpg thumbnail).
// Sorting paths therefore sorts clips oldest-first.
import fs from 'node:fs'
import path from 'node:path'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const GB = 1024 ** 3

const pad = (n) => String(n).padStart(2, '0')
export const dayName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const timeName = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

export function clipPath(root, date, event, cameraId) {
  return path.join(root, dayName(date), `${timeName(date)}_${event}_${cameraId}.mp4`)
}

const dayDirs = (root) =>
  fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DAY_RE.test(e.name))
    .map((e) => e.name)
    .sort()

export function listClips(root) {
  return dayDirs(root).flatMap((day) =>
    fs.readdirSync(path.join(root, day))
      .filter((f) => f.endsWith('.mp4'))
      .sort()
      .map((f) => path.join(root, day, f)))
}

const thumbOf = (clip) => clip.replace(/\.mp4$/, '.jpg')
const sizeOf = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0)
const freeBytes = (root) => {
  const s = fs.statfsSync(root)
  return s.bavail * s.bsize
}

/**
 * Delete clips older than keepDays, then oldest-first while all clips together take more
 * than maxStorageGb (0 = no cap) or the disk has less than minFreeGb free.
 */
export function prune(root, { keepDays, maxStorageGb, minFreeGb, now = new Date(), getFree = freeBytes, log = console.log }) {
  const today = Date.parse(dayName(now))
  for (const day of dayDirs(root)) {
    if ((today - Date.parse(day)) / 86400000 > keepDays) {
      log(`pruning ${day} (older than ${keepDays} days)`)
      fs.rmSync(path.join(root, day), { recursive: true, force: true })
    }
  }

  const clips = listClips(root)
  let used = dayDirs(root).reduce((sum, day) => sum + fs.readdirSync(path.join(root, day))
    .reduce((s, f) => s + sizeOf(path.join(root, day, f)), 0), 0)
  const maxBytes = maxStorageGb * GB
  while (clips.length) {
    const overCap = maxBytes > 0 && used > maxBytes
    const diskLow = getFree(root) < minFreeGb * GB
    if (!overCap && !diskLow) break
    const oldest = clips.shift()
    log(`pruning ${path.relative(root, oldest)} (${overCap ? 'storage cap' : 'disk low'})`)
    for (const f of [oldest, thumbOf(oldest)]) {
      used -= sizeOf(f)
      fs.rmSync(f, { force: true })
    }
  }

  for (const day of dayDirs(root)) {
    const dir = path.join(root, day)
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Write a phone-friendly index.html listing every clip, newest first. */
export function writeIndex(root) {
  const rows = []
  let currentDay
  for (const clip of listClips(root).reverse()) {
    const day = path.basename(path.dirname(clip))
    const name = path.basename(clip)
    if (day !== currentDay) {
      rows.push(`<h2>${esc(day)}</h2>`)
      currentDay = day
    }
    const [hms, event] = name.split('_')
    const rel = `${day}/${encodeURIComponent(name)}`
    const thumb = thumbOf(clip)
    const poster = fs.existsSync(thumb) ? ` poster="${day}/${encodeURIComponent(path.basename(thumb))}"` : ''
    rows.push(`<figure><video controls preload="none"${poster} src="${rel}"></video>` +
      `<figcaption>${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)} &middot; ${esc(event)}` +
      ` &middot; <a href="${rel}" download>download</a></figcaption></figure>`)
  }
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doorbell Recordings</title>
<style>
:root { color-scheme: light dark; --bg:#fafafa; --fg:#111; --muted:#666; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#999; } }
body { margin:0 auto; padding:16px; max-width:720px; font-family:system-ui,sans-serif; background:var(--bg); color:var(--fg); }
h2 { font-size:1rem; color:var(--muted); margin:24px 0 8px; }
figure { margin:0 0 16px; }
video { width:100%; border-radius:8px; background:#000; }
figcaption { font-size:.9rem; color:var(--muted); padding-top:4px; }
a { color:inherit; }
</style></head><body>
<h1>Doorbell recordings</h1>
${rows.join('\n') || '<p>No recordings yet.</p>'}
</body></html>
`
  const tmp = path.join(root, 'index.html.part')
  fs.writeFileSync(tmp, page)
  fs.renameSync(tmp, path.join(root, 'index.html'))
}
