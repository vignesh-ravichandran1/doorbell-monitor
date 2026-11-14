import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { clipPath, clipSummary, prune, deleteClips, setKept } from '../src/storage.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-'))
const quiet = () => {}
const plenty = () => 1e15

function makeClip(root, day, name, bytes = 1) {
  fs.mkdirSync(path.join(root, day), { recursive: true })
  const clip = path.join(root, day, name)
  fs.writeFileSync(clip, Buffer.alloc(bytes))
  fs.writeFileSync(clip.replace('.mp4', '.jpg'), Buffer.alloc(1))
  return clip
}

test('clipPath builds dated, sortable names', () => {
  const p = clipPath('/r', new Date(2026, 0, 5, 9, 3, 7), 'ding', 'abc')
  assert.equal(p, path.join('/r', '2026-01-05', '090307_ding_abc.mp4'))
})

test('prune removes days older than keepDays', () => {
  const root = tmp()
  const old = makeClip(root, '2026-01-01', '120000_ding_a.mp4')
  const kept = makeClip(root, '2026-01-30', '120000_motion_a.mp4')
  prune(root, { keepDays: 10, maxStorageGb: 0, minFreeGb: 0, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.ok(!fs.existsSync(path.dirname(old)))
  assert.ok(fs.existsSync(kept))
})

test('prune enforces the storage cap, oldest first', () => {
  const root = tmp()
  const clips = [1, 2, 3, 4].map((h) => makeClip(root, '2026-01-31', `0${h}0000_ding_a.mp4`, 1000))
  prune(root, { keepDays: 365, maxStorageGb: 2100 / 1024 ** 3, minFreeGb: 0, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.deepEqual(clips.map((c) => fs.existsSync(c)), [false, false, true, true])
  assert.ok(!fs.existsSync(clips[0].replace('.mp4', '.jpg')))
})

test('prune frees disk space oldest first and removes empty days', () => {
  const root = tmp()
  const a = makeClip(root, '2026-01-30', '080000_ding_a.mp4')
  const b = makeClip(root, '2026-01-31', '090000_ding_a.mp4')
  const frees = [0, 1e15]
  prune(root, { keepDays: 365, maxStorageGb: 0, minFreeGb: 5, now: new Date(2026, 1, 1), getFree: () => frees.shift(), log: quiet })
  assert.ok(!fs.existsSync(path.dirname(a)))
  assert.ok(fs.existsSync(b))
})

test('a zero cap means unlimited', () => {
  const root = tmp()
  const clip = makeClip(root, '2026-01-31', '010000_ding_a.mp4')
  prune(root, { keepDays: 365, maxStorageGb: 0, minFreeGb: 0, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.ok(fs.existsSync(clip))
})

test('age limit is off by default (keepDays 0): old clips stay while there is space', () => {
  const root = tmp()
  const old = makeClip(root, '2020-01-01', '120000_ding_a.mp4')
  prune(root, { keepDays: 0, maxStorageGb: 1, minFreeGb: 0, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.ok(fs.existsSync(old))
})

test('clipSummary lists newest first with thumbnails and total size', async () => {
  const root = tmp()
  makeClip(root, '2026-01-30', '080000_ding_a.mp4', 10)
  makeClip(root, '2026-01-31', '093015_motion_a.mp4', 20)
  const { clips, usedBytes } = await clipSummary(root)
  assert.deepEqual(clips.map((c) => [c.day, c.time, c.event]), [['2026-01-31', '09:30:15', 'motion'], ['2026-01-30', '08:00:00', 'ding']])
  assert.match(clips[0].thumb, /^\/2026-01-31\/093015_motion_a\.jpg\?v=[0-9a-z]+$/)
  assert.equal(usedBytes, 10 + 1 + 20 + 1)
})

test('clipSummary orders rings and motion together, newest first', async () => {
  const root = tmp()
  for (const name of ['090000_ding_a.mp4', '100000_motion_a.mp4', '110000_ding_a.mp4', '113000_motion_a.mp4']) {
    makeClip(root, '2026-01-31', name)
  }
  makeClip(root, '2026-02-01', '070000_motion_a.mp4')
  const order = (await clipSummary(root)).clips.map((c) => `${c.day} ${c.time} ${c.event}`)
  assert.deepEqual(order, [
    '2026-02-01 07:00:00 motion',
    '2026-01-31 11:30:00 motion',
    '2026-01-31 11:00:00 ding',
    '2026-01-31 10:00:00 motion',
    '2026-01-31 09:00:00 ding',
  ])
})

test('deleteClips removes a clip with its thumbnail and tags, then the empty day folder', async () => {
  const root = tmp()
  const clip = makeClip(root, '2026-01-31', '090000_ding_a.mp4')
  fs.writeFileSync(clip.replace('.mp4', '.json'), '{}')
  const keep = makeClip(root, '2026-01-30', '080000_motion_a.mp4')
  const old = Date.now() - 60_000
  for (const f of [clip, keep]) fs.utimesSync(f, old / 1000, old / 1000)
  const { deleted, skipped } = await deleteClips(root, ['/2026-01-31/090000_ding_a.mp4'])
  assert.deepEqual(deleted, ['/2026-01-31/090000_ding_a.mp4'])
  assert.deepEqual(skipped, [])
  assert.ok(!fs.existsSync(path.join(root, '2026-01-31')), 'empty day folder removed')
  assert.ok(fs.existsSync(keep) && fs.existsSync(keep.replace('.mp4', '.jpg')))
})

test('deleteClips refuses anything that is not a clip inside the recordings folder', async () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'secret.txt'), 'x')
  const { deleted, skipped } = await deleteClips(root, [
    '/../package.json', '/2026-01-31/../../secret.txt', '/secret.txt', '/2026-01-31/notes.mp4', '%E0%A4%A',
  ])
  assert.deepEqual(deleted, [])
  assert.equal(skipped.length, 5)
  assert.ok(fs.existsSync(path.join(root, 'secret.txt')))
})

test('deleteClips skips a clip that is still being recorded', async () => {
  const root = tmp()
  const clip = makeClip(root, '2026-01-31', '090000_motion_a.mp4') // just written
  const { deleted, skipped } = await deleteClips(root, ['/2026-01-31/090000_motion_a.mp4'])
  assert.deepEqual(deleted, [])
  assert.equal(skipped[0].reason, 'still recording')
  assert.ok(fs.existsSync(clip))
})

test('protected rings: over the cap, motion clips go first even when a ring is older', () => {
  const root = tmp()
  const ring = makeClip(root, '2026-01-29', '080000_ding_a.mp4', 1000)
  const m1 = makeClip(root, '2026-01-30', '080000_motion_a.mp4', 1000)
  const m2 = makeClip(root, '2026-01-31', '080000_motion_a.mp4', 1000)
  fs.writeFileSync(m1.replace('.mp4', '.json'), '{}')
  prune(root, { keepDays: 0, maxStorageGb: 2500 / 1024 ** 3, minFreeGb: 0, protectRings: true, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.ok(fs.existsSync(ring), 'ring kept')
  assert.ok(!fs.existsSync(m1) && !fs.existsSync(m1.replace('.mp4', '.json')), 'oldest motion clip and its files gone')
  assert.ok(fs.existsSync(m2))
})

test('protected rings may use at most half the space; beyond that the oldest ring goes', () => {
  const root = tmp()
  const r1 = makeClip(root, '2026-01-29', '080000_ding_a.mp4', 1000)
  const r2 = makeClip(root, '2026-01-30', '080000_ding_a.mp4', 1000)
  const m = makeClip(root, '2026-01-31', '080000_motion_a.mp4', 500)
  // 2503 bytes in all, cap 2400: rings (2002) are over half the cap (1200), so the oldest ring
  // goes rather than the motion clip, and that's enough
  prune(root, { keepDays: 0, maxStorageGb: 2400 / 1024 ** 3, minFreeGb: 0, protectRings: true, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.deepEqual([r1, r2, m].map((c) => fs.existsSync(c)), [false, true, true])
})

test('protected rings are exempt from the day limit', () => {
  const root = tmp()
  const ring = makeClip(root, '2026-01-01', '080000_ding_a.mp4')
  const motion = makeClip(root, '2026-01-01', '090000_motion_a.mp4')
  prune(root, { keepDays: 10, maxStorageGb: 0, minFreeGb: 0, protectRings: true, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.ok(fs.existsSync(ring))
  assert.ok(!fs.existsSync(motion))
})

test('disk almost full still deletes, motion clips first', () => {
  const root = tmp()
  const ring = makeClip(root, '2026-01-29', '080000_ding_a.mp4')
  const motion = makeClip(root, '2026-01-30', '080000_motion_a.mp4')
  const frees = [0, 1e15]
  prune(root, { keepDays: 0, maxStorageGb: 0, minFreeGb: 5, protectRings: true, now: new Date(2026, 1, 1), getFree: () => frees.shift(), log: quiet })
  assert.ok(fs.existsSync(ring))
  assert.ok(!fs.existsSync(motion))
})

test('kept clips are never purged, by cap, days or a full disk; unkeeping makes them purgeable', async () => {
  const root = tmp()
  const kept = makeClip(root, '2026-01-01', '080000_motion_a.mp4', 1000)
  const other = makeClip(root, '2026-01-30', '080000_motion_a.mp4', 1000)
  assert.equal(await setKept(root, '/2026-01-01/080000_motion_a.mp4', true), true)
  assert.equal(await setKept(root, '/../secret.mp4', true), false)
  assert.equal((await clipSummary(root)).clips.find((c) => c.day === '2026-01-01').kept, true)
  const frees = [0, 0, 0]
  prune(root, { keepDays: 5, maxStorageGb: 100 / 1024 ** 3, minFreeGb: 5, now: new Date(2026, 1, 1), getFree: () => frees.shift() ?? 0, log: quiet })
  assert.ok(fs.existsSync(kept), 'kept clip survives')
  assert.ok(!fs.existsSync(other))
  await setKept(root, '/2026-01-01/080000_motion_a.mp4', false)
  prune(root, { keepDays: 5, maxStorageGb: 0, minFreeGb: 0, now: new Date(2026, 1, 1), getFree: plenty, log: quiet })
  assert.ok(!fs.existsSync(kept))
})
