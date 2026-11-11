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
// Async (it's called per page load and stats every file): a synchronous version would stall the
// whole recorder whenever the disk is busy.
export async function clipSummary(root) {
  const sizes = new Map()
  const days = (await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && DAY_RE.test(e.name)).map((e) => e.name)
  const names = await Promise.all(days.map(async (day) => {
    const files = await fs.promises.readdir(path.join(root, day)).catch(() => [])
    await Promise.all(files.map(async (f) => {
      const st = await fs.promises.stat(path.join(root, day, f)).catch(() => null)
      if (st) sizes.set(path.join(root, day, f), st)
    }))
    return files.filter((f) => f.endsWith('.mp4')).map((f) => path.join(root, day, f))
  }))
  let usedBytes = 0
  const clips = names.flat().map((clip) => {
    const day = path.basename(path.dirname(clip))
    const name = path.basename(clip)
    const [hms, event] = name.split('_')
    const thumb = thumbOf(clip)
    const hasThumb = sizes.has(thumb)
    const size = (sizes.get(clip)?.size || 0) + (sizes.get(thumb)?.size || 0)
    usedBytes += size
    return {
      day,
      time: `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`,
      event,
      url: `/${day}/${encodeURIComponent(name)}`,
      // ?v= changes when the thumbnail is re-made, since browsers keep thumbnails for a week.
      thumb: hasThumb ? `/${day}/${encodeURIComponent(path.basename(thumb))}?v=${Math.floor(sizes.get(thumb).mtimeMs).toString(36)}` : null,
      size,
    }
  })
  // Newest first by date and time only; ring vs motion never affects the order.
  clips.sort((a, b) => `${b.day} ${b.time}`.localeCompare(`${a.day} ${a.time}`))
  return { clips, usedBytes }
}

const CLIP_NAME_RE = /^\d{6}_[a-z]+_[\w-]+\.mp4$/

/**
 * Delete clips by their page URLs (/<day>/<name>.mp4), with every file sharing the clip's
 * name (thumbnail, tags). Only real clip paths inside root are accepted, and a clip written
 * to in the last `busyMs` is skipped because it is probably still recording.
 */
export async function deleteClips(root, urls, { now = Date.now(), busyMs = 15_000 } = {}) {
  const deleted = []
  const skipped = []
  const days = new Set()
  for (const url of urls) {
    let day, name
    try {
      [, day, name] = decodeURIComponent(String(url).split('?')[0]).split('/')
    } catch {
      skipped.push({ url, reason: 'bad address' })
      continue
    }
    if (!DAY_RE.test(day || '') || !CLIP_NAME_RE.test(name || '')) {
      skipped.push({ url, reason: 'not a clip' })
      continue
    }
    const clip = path.join(root, day, name)
    const st = await fs.promises.stat(clip).catch(() => null)
    if (!st) {
      skipped.push({ url, reason: 'already gone' })
      continue
    }
    if (now - st.mtimeMs < busyMs) {
      skipped.push({ url, reason: 'still recording' })
      continue
    }
    const stem = name.slice(0, -'.mp4'.length)
    const files = await fs.promises.readdir(path.join(root, day))
    for (const f of files) {
      if (f === name || f.startsWith(`${stem}.`)) await fs.promises.rm(path.join(root, day, f), { force: true })
    }
    deleted.push(url)
    days.add(day)
  }
  for (const day of days) {
    const dir = path.join(root, day)
    if ((await fs.promises.readdir(dir)).length === 0) await fs.promises.rmdir(dir).catch(() => {})
  }
  return { deleted, skipped }
}
