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
 * Keep as many clips as fit: delete oldest-first only while all clips together take more
 * than maxStorageGb (0 = no cap) or the disk has less than minFreeGb free.
 * keepDays > 0 additionally deletes clips older than that (off by default).
 */
export function prune(root, { keepDays, maxStorageGb, minFreeGb, now = new Date(), getFree = freeBytes, log = console.log }) {
  const today = Date.parse(dayName(now))
  for (const day of keepDays > 0 ? dayDirs(root) : []) {
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

/** Every clip, newest first, plus total size: the data behind the clips page. */
export function clipSummary(root) {
  let usedBytes = 0
  const clips = listClips(root).reverse().map((clip) => {
    const day = path.basename(path.dirname(clip))
    const name = path.basename(clip)
    const [hms, event] = name.split('_')
    const thumb = thumbOf(clip)
    const hasThumb = fs.existsSync(thumb)
    const size = sizeOf(clip) + sizeOf(thumb)
    usedBytes += size
    return {
      day,
      time: `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`,
      event,
      url: `/${day}/${encodeURIComponent(name)}`,
      thumb: hasThumb ? `/${day}/${encodeURIComponent(path.basename(thumb))}` : null,
      size,
    }
  })
  return { clips, usedBytes }
}
