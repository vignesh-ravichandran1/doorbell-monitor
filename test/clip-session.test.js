import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ClipSession } from '../src/clip-session.js'

const cfg = { dingSeconds: 60, motionSeconds: 30, maxSeconds: 120 }
const T0 = 1_000_000

test('rings record longer than motion', () => {
  const ding = new ClipSession('ding', cfg)
  ding.start(T0)
  assert.equal(ding.deadline, T0 + 60_000)
  const motion = new ClipSession('motion', cfg)
  motion.start(T0)
  assert.equal(motion.deadline, T0 + 30_000)
})

test('new motion extends the clip from now', () => {
  const s = new ClipSession('motion', cfg)
  s.start(T0)
  s.extend('motion', T0 + 25_000)
  assert.equal(s.deadline, T0 + 55_000)
})

test('extension never shortens the clip', () => {
  const s = new ClipSession('ding', cfg)
  s.start(T0)
  s.extend('motion', T0 + 5_000) // 5 + 30 < 60
  assert.equal(s.deadline, T0 + 60_000)
})

test('a ring during a motion clip makes it a longer ring clip', () => {
  const s = new ClipSession('motion', cfg)
  s.start(T0)
  s.extend('ding', T0 + 20_000)
  assert.equal(s.event, 'ding')
  assert.equal(s.deadline, T0 + 80_000)
})

test('clips are capped at maxSeconds', () => {
  const s = new ClipSession('motion', cfg)
  s.start(T0)
  for (let t = 20; t <= 200; t += 20) s.extend('motion', T0 + t * 1000)
  assert.equal(s.deadline, T0 + 120_000)
})

test('events while still connecting extend from the start of video', () => {
  const s = new ClipSession('motion', cfg)
  s.extend('ding') // before start()
  s.start(T0)
  assert.equal(s.deadline, T0 + 60_000)
})

test('remembers when the first ring happened, for the thumbnail', () => {
  assert.equal(new ClipSession('ding', cfg).ringAt, 0)
  const s = new ClipSession('motion', cfg)
  s.start(T0)
  assert.equal(s.ringAt, null)
  s.extend('ding', T0 + 12_000)
  s.extend('ding', T0 + 20_000)
  assert.equal(s.ringAt, 12)
})
