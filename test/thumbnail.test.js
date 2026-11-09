// The thumbnail picker on synthetic frames, plus one end-to-end run on a generated clip.
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { findFfmpeg } from '../src/config.js'
import { makeThumbnail, pickTime } from '../src/thumbnail.js'

const W = 16
const H = 9
const size = { w: W, h: H }
// A textured background (so it isn't "blurry"), optionally with a bright block (the "person").
function frame(t, { person = false, blur = false } = {}) {
  const px = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      px[y * W + x] = blur ? 100 : ((x + y) % 2 ? 60 : 140)
      if (person && x >= 6 && x < 10 && y >= 2 && y < 8) px[y * W + x] = (x + y) % 2 ? 220 : 250
    }
  }
  return { t, px }
}
const clip = (n, personAt = [], blurAt = []) =>
  Array.from({ length: n }, (_, i) => frame(i / 2, { person: personAt.includes(i), blur: blurAt.includes(i) }))

test('motion clip: picks a frame with the person, not the empty start', () => {
  const t = pickTime(clip(20, [10, 11, 12]), { size })
  assert.ok(t >= 5 && t <= 6, `picked ${t}s`)
})

test('motion clip: works when the person is there at the start and leaves', () => {
  const t = pickTime(clip(20, [0, 1, 2, 3, 4, 5, 6]), { size })
  assert.ok(t >= 1 && t <= 3, `picked ${t}s`)
})

test('skips a blurry frame even if it differs most', () => {
  const t = pickTime(clip(20, [10, 11], [14]), { size })
  assert.ok(t >= 5 && t <= 5.5, `picked ${t}s`)
})

test('ring clip: picks within the seconds after the ring', () => {
  // People at 2-3 s and at 12-13 s; the ring was at 11 s.
  const t = pickTime(clip(40, [4, 5, 6, 24, 25, 26]), { ringAt: 11, size })
  assert.ok(t >= 12 && t <= 13, `picked ${t}s`)
})

test('nothing changes: middle of a motion clip, just after a ring', () => {
  assert.equal(pickTime(clip(21), { size }), 5.5)
  assert.equal(pickTime(clip(21), { ringAt: 3, size }), 3)
})

test('makes a thumbnail from a real clip', { timeout: 60_000 }, async () => {
  const ffmpeg = await findFfmpeg()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-thumb-'))
  const mp4 = path.join(dir, 'c.mp4')
  // 6 s of grey, with a white box present from 3 s to 4 s.
  spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=gray:size=320x180:rate=10:duration=6',
    '-vf', "noise=alls=20:allf=t,drawbox=x=120:y=50:w=80:h=80:color=white:t=fill:enable='between(t,3,4)'",
    '-c:v', 'libx264', '-preset', 'ultrafast', mp4])
  const jpg = path.join(dir, 'c.jpg')
  const t = await makeThumbnail(ffmpeg, mp4, jpg, { run: promisify(execFile) })
  assert.ok(t >= 3 && t <= 4, `picked ${t}s`)
  assert.ok(fs.statSync(jpg).size > 1000, 'thumbnail written')
  fs.rmSync(dir, { recursive: true, force: true })
})
