import assert from 'node:assert/strict'
import { test } from 'node:test'
import { health, report } from '../src/health.js'

const T0 = 1_000_000_000
const min = 60_000
const push = (s) => () => s

test('starting up: logging in, then connecting to events, then OK', () => {
  health.reset(T0)
  assert.equal(report(T0 + 10_000).level, 'starting')
  health.watching(['Front Door'], push({ connectedAt: 0, downSince: T0, drops: 0 }))
  assert.equal(report(T0 + 20_000).level, 'starting')
  health.watching(['Front Door'], push({ connectedAt: T0 + 30_000, downSince: 0, drops: 0 }))
  const r = report(T0 + 40_000)
  assert.equal(r.level, 'ok')
  assert.match(r.headline, /watching Front Door/)
})

test('no Ring login after a few minutes is a problem', () => {
  health.reset(T0)
  const r = report(T0 + 4 * min)
  assert.equal(r.level, 'problem')
  assert.match(r.headline, /Not connected to Ring/)
})

test('event connection down for more than 3 minutes is a problem; a short drop is not', () => {
  health.reset(T0)
  health.watching(['Front Door'], push({ connectedAt: 0, downSince: T0 + 60 * min, drops: 1 }))
  assert.equal(report(T0 + 61 * min).level, 'starting', 'brief reconnect')
  const r = report(T0 + 70 * min)
  assert.equal(r.level, 'problem')
  assert.match(r.headline, /down for 10 min/)
})

test('a failed recording is a problem until the next clip is saved', () => {
  health.reset(T0)
  health.watching(['Front Door'], push({ connectedAt: T0, downSince: 0, drops: 0 }))
  health.event('ding', 'Front Door')
  health.recordingFailed('no video received from the doorbell')
  let r = report(T0 + 5 * min)
  assert.equal(r.level, 'problem')
  assert.match(r.headline, /no video received/)
  health.clip('120000_ding_x.mp4', 60)
  r = report(T0 + 6 * min)
  assert.equal(r.level, 'ok')
  assert.equal(r.lastClip.seconds, 60)
  assert.equal(r.lastEvent.event, 'ding')
})
