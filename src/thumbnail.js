// Picks the clip's thumbnail: a frame that shows what happened, not the first seconds (usually
// an empty doorway or someone still far away).
//  - Ring clips: the best frame in the few seconds after the ring (person at the door).
//  - Motion clips: the frame that differs most from the empty scene, skipping blurry frames.
//    The empty scene is taken from the end of the clip: recording runs on ~30 s after the last
//    motion, so the visitor has usually left by then, while at the start they're often already
//    in view (they triggered the recording).
// It looks at small greyscale frames (2 per second, 160x90) decoded by ffmpeg at below-normal
// priority, so it costs a second or two of CPU per clip and needs no extra libraries.
import { spawn } from 'node:child_process'
import os from 'node:os'

const W = 160
const H = 90
const FPS = 2
const RING_WINDOW_S = 5 // after a ring, look this far ahead for the best frame
const SKIP_START_S = 1 // the stream's first frames can be grey or smeared

/** Small greyscale frames from the clip: [{ t (seconds), px (Uint8Array W*H) }]. */
export function sampleFrames(ffmpeg, clip) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', clip,
      '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true })
    try { os.setPriority(ff.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch {}
    const chunks = []
    let err = ''
    ff.stdout.on('data', (c) => chunks.push(c))
    ff.stderr.on('data', (c) => { err += c })
    ff.on('error', reject)
    ff.on('close', (code) => {
      const all = Buffer.concat(chunks)
      const frames = []
      for (let i = 0; (i + 1) * W * H <= all.length; i++) {
        frames.push({ t: i / FPS, px: new Uint8Array(all.buffer, all.byteOffset + i * W * H, W * H) })
      }
      if (!frames.length) reject(new Error(`no frames (ffmpeg exit ${code}): ${err.trim().split('\n')[0]}`))
      else resolve(frames)
    })
  })
}

/** Mean absolute difference between two frames, 0-255. */
export function difference(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** Mean gradient strength: low for blurry, smeared or grey frames. */
export function sharpness(px, w = W, h = H) {
  let sum = 0
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      sum += Math.abs(px[i] - px[i + 1]) + Math.abs(px[i] - px[i + w])
    }
  }
  return sum / ((w - 1) * (h - 1))
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** Per-pixel median of the last quarter of the clip: the scene with nobody in it, usually. */
export function background(frames) {
  const end = frames[frames.length - 1].t
  const tail = frames.filter((f) => f.t >= end * 0.75)
  const out = new Uint8Array(tail[0].px.length)
  const vals = new Array(tail.length)
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < tail.length; k++) vals[k] = tail[k].px[i]
    out[i] = median(vals)
  }
  return out
}

/**
 * Seconds into the clip for the thumbnail. `ringAt`: seconds into the clip of the first ring,
 * or null for a motion clip. A frame scores by how much it differs from the empty scene (see
 * background()), and loses score when it is blurrier than the clip's typical frame.
 */
export function pickTime(frames, { ringAt = null, size = { w: W, h: H } } = {}) {
  const end = frames[frames.length - 1].t
  let from = Math.min(SKIP_START_S, end)
  let to = end
  if (ringAt !== null) {
    from = Math.min(Math.max(ringAt, SKIP_START_S), end)
    to = Math.min(from + RING_WINDOW_S, end)
  }
  const window = frames.filter((f) => f.t >= from && f.t <= to)
  if (!window.length) return from

  const empty = background(frames)
  const sharp = frames.map((f) => sharpness(f.px, size.w, size.h))
  const typical = median(sharp) || 1
  let best = null
  for (const f of window) {
    const change = difference(f.px, empty)
    const clarity = Math.min(1, sharp[frames.indexOf(f)] / typical)
    const score = change * clarity
    if (!best || score > best.score) best = { t: f.t, score, change }
  }
  // Nothing stands out (nobody in view the whole clip, or someone there until the end):
  // for a ring, just after the ring; otherwise the middle of the clip.
  if (best.change < 2) return ringAt !== null ? from : (from + to) / 2
  return best.t
}

/**
 * Writes `thumb` (640 px wide JPEG) from the most telling frame of `clip`. Returns the chosen
 * second. If the analysis fails, falls back to the frame 2 s in (the old behaviour).
 */
export async function makeThumbnail(ffmpeg, clip, thumb, { ringAt = null, run } = {}) {
  let t = 2
  try {
    t = pickTime(await sampleFrames(ffmpeg, clip), { ringAt })
  } catch {}
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', clip,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', thumb])
  return t
}
