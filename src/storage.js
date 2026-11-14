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

const isRing = (clip) => path.basename(clip).split('_')[1] === 'ding'
// A clip marked "Keep" on the page has an empty <clip>.keep file next to it; it is never purged.
const keepFile = (clip) => clip.replace(/\.mp4$/, '.keep')

// One pass over the recordings: every clip (oldest first) with all the files that belong to it
// (video, thumbnail, tags, keep marker) and their total size. Each folder is read once, so
// pruning stays quick with thousands of clips (it runs after every recording).
function scanClips(root) {
  const clips = []
  let used = 0
  for (const day of dayDirs(root)) {
    const dir = path.join(root, day)
    const byStem = new Map() // clip name without extension -> { files, bytes }
    for (const f of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, f)
      const bytes = sizeOf(file)
      used += bytes
      const stem = f.slice(0, f.indexOf('.') < 0 ? f.length : f.indexOf('.'))
      const entry = byStem.get(stem) ?? { files: [], bytes: 0 }
      entry.files.push(file)
      entry.bytes += bytes
      byStem.set(stem, entry)
    }
    for (const [stem, { files, bytes }] of byStem) {
      const clip = path.join(dir, `${stem}.mp4`)
      if (!files.includes(clip)) continue
      clips.push({ clip, day, files, bytes, ring: isRing(clip), kept: files.includes(keepFile(clip)) })
    }
  }
  return { clips, used }
}

/**
 * Keep as many clips as fit: delete oldest-first only while all clips together take more
 * than maxStorageGb (0 = no cap) or the disk has less than minFreeGb free.
 * keepDays > 0 additionally deletes clips older than that (off by default).
 * protectRings: ring clips go only after every motion clip, and are exempt from keepDays. So they
 * can't crowd out motion clips for good, they may use at most half of maxStorageGb; beyond that
 * the oldest rings go first.
 */
export function prune(root, { keepDays, maxStorageGb, minFreeGb, protectRings = false, now = new Date(), getFree = freeBytes, log = console.log }) {
  dayCache.clear() // pruning may delete from any day
  const today = Date.parse(dayName(now))
  let { clips, used } = scanClips(root)
  const remove = (c) => {
    for (const f of c.files) fs.rmSync(f, { force: true })
    used -= c.bytes
  }

  if (keepDays > 0) {
    const removed = new Map() // day -> count, for one log line per day
    clips = clips.filter((c) => {
      if ((today - Date.parse(c.day)) / 86400000 <= keepDays || (protectRings && c.ring) || c.kept) return true
      remove(c)
      removed.set(c.day, (removed.get(c.day) || 0) + 1)
      return false
    })
    for (const [day, n] of removed) log(`pruning ${n} clip(s) from ${day} (older than ${keepDays} days)`)
  }

  // Kept clips are never candidates, so only you can delete them (from the page).
  clips = clips.filter((c) => !c.kept)
  let ringBytes = protectRings ? clips.reduce((sum, c) => sum + (c.ring ? c.bytes : 0), 0) : 0
  const maxBytes = maxStorageGb * GB
  while (clips.length) {
    const overCap = maxBytes > 0 && used > maxBytes
    const diskLow = getFree(root) < minFreeGb * GB
    if (!overCap && !diskLow) break
    let victim = clips[0]
    let reason = overCap ? 'storage cap' : 'disk low'
    if (protectRings) {
      const rings = ringBytes > maxBytes / 2 && maxBytes > 0 && !diskLow
      victim = rings ? clips.find((c) => c.ring) : clips.find((c) => !c.ring) ?? clips[0]
      if (rings) reason = 'ring clips over half the space'
    }
    clips.splice(clips.indexOf(victim), 1)
    log(`pruning ${path.relative(root, victim.clip)} (${reason})`)
    remove(victim)
    if (victim.ring) ringBytes -= victim.bytes
  }

  for (const day of dayDirs(root)) {
    const dir = path.join(root, day)
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }
}

// clipSummary's memory of past days: folder -> { mtimeMs, at, entries }. Dropped whenever this
// module changes a folder, when the folder's own timestamp changes, and after 5 minutes anyway.
const dayCache = new Map()
const DAY_CACHE_MS = 5 * 60_000

/** Every clip, newest first, plus total size: the data behind the clips page. */
// Async (it's called per page load and stats every file): a synchronous version would stall the
// whole recorder whenever the disk is busy.
export async function clipSummary(root, now = new Date()) {
  const sizes = new Map()
  const today = dayName(now)
  const days = (await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && DAY_RE.test(e.name)).map((e) => e.name)
  const names = await Promise.all(days.map(async (day) => {
    const dir = path.join(root, day)
    // Past days rarely change, so their file sizes are remembered instead of checking every file
    // on every request (each open page asks every 30 s). Today's folder is always read fresh.
    const dirStat = day === today ? null : await fs.promises.stat(dir).catch(() => null)
    const cached = dayCache.get(dir)
    let entries
    if (dirStat && cached && cached.mtimeMs === dirStat.mtimeMs && Date.now() - cached.at < DAY_CACHE_MS) {
      entries = cached.entries
    } else {
      const files = await fs.promises.readdir(dir).catch(() => [])
      entries = (await Promise.all(files.map(async (f) => {
        const st = await fs.promises.stat(path.join(dir, f)).catch(() => null)
        return st && [f, { size: st.size, mtimeMs: st.mtimeMs }]
      }))).filter(Boolean)
      if (dirStat) dayCache.set(dir, { mtimeMs: dirStat.mtimeMs, at: Date.now(), entries })
    }
    for (const [f, st] of entries) sizes.set(path.join(dir, f), st)
    return entries.map(([f]) => f).filter((f) => f.endsWith('.mp4')).map((f) => path.join(dir, f))
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
      kept: sizes.has(keepFile(clip)),
    }
  })
  // Newest first by date and time only; ring vs motion never affects the order.
  clips.sort((a, b) => `${b.day} ${b.time}`.localeCompare(`${a.day} ${a.time}`))
  return { clips, usedBytes }
}

const CLIP_NAME_RE = /^\d{6}_[a-z]+_[\w-]+\.mp4$/

/** Mark or unmark a clip (by its page URL) as kept. Returns false if it isn't a real clip. */
export async function setKept(root, url, kept) {
  let day, name
  try {
    [, day, name] = decodeURIComponent(String(url).split('?')[0]).split('/')
  } catch {
    return false
  }
  if (!DAY_RE.test(day || '') || !CLIP_NAME_RE.test(name || '')) return false
  const clip = path.join(root, day, name)
  if (!(await fs.promises.stat(clip).catch(() => null))) return false
  if (kept) await fs.promises.writeFile(keepFile(clip), '')
  else await fs.promises.rm(keepFile(clip), { force: true })
  dayCache.delete(path.dirname(clip))
  return true
}

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
    dayCache.delete(path.join(root, day))
  }
  for (const day of days) {
    const dir = path.join(root, day)
    if ((await fs.promises.readdir(dir)).length === 0) await fs.promises.rmdir(dir).catch(() => {})
  }
  return { deleted, skipped }
}
