import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Sessions, applySettings, checkPin, hashPin, validateSettings } from '../src/settings.js'

const baseConfig = () => ({
  maxStorageGb: 20, minFreeGb: 5, keepDays: 0, recordSecondsDing: 60, recordSecondsMotion: 30, maxClipSeconds: 120,
  recordOn: new Set(['ding', 'motion']), notifyOn: new Set(), motionCooldownSeconds: 120, ntfyTopic: '', webBaseUrl: '',
  recordingsDir: '/tmp/x', webPort: 8080,
})

test('valid changes are returned as .env strings; unchanged values are skipped', () => {
  const { values, errors } = validateSettings({ MAX_STORAGE_GB: '5', KEEP_DAYS: '0', RECORD_ON: ['ding'] }, baseConfig())
  assert.deepEqual(errors, {})
  assert.deepEqual(values, { MAX_STORAGE_GB: '5', RECORD_ON: 'ding' })
})

test('bad values are rejected and nothing is saved', () => {
  const { values, errors } = validateSettings({ MAX_STORAGE_GB: '5', RECORD_SECONDS_DING: '2', WEB_PORT: '80', NTFY_TOPIC: 'a b', WEB_BASE_URL: 'javascript:alert(1)' }, baseConfig())
  assert.deepEqual(values, {})
  assert.deepEqual(Object.keys(errors).sort(), ['NTFY_TOPIC', 'RECORD_SECONDS_DING', 'WEB_BASE_URL', 'WEB_PORT'])
})

test('longest clip must cover the clip lengths', () => {
  const { errors } = validateSettings({ RECORD_SECONDS_DING: '90', MAX_CLIP_SECONDS: '60' }, baseConfig())
  assert.match(errors.MAX_CLIP_SECONDS, /at least/)
})

test('applySettings updates config live and writes the env file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-env-')), '.env')
  fs.writeFileSync(file, 'MAX_STORAGE_GB=20     # space\nRECORD_ON=ding,motion\n')
  const config = baseConfig()
  const restart = applySettings({ MAX_STORAGE_GB: '5', RECORD_ON: 'ding', WEB_PORT: '8081' }, config, file)
  assert.equal(config.maxStorageGb, 5)
  assert.deepEqual([...config.recordOn], ['ding'])
  assert.equal(config.webPort, 8080, 'port only changes after a restart')
  assert.deepEqual(restart, ['WEB_PORT'])
  assert.equal(fs.readFileSync(file, 'utf8'), 'MAX_STORAGE_GB=5     # space\nRECORD_ON=ding\nWEB_PORT=8081\n')
  delete process.env.WEB_PORT
  delete process.env.MAX_STORAGE_GB
  delete process.env.RECORD_ON
})

test('PIN hashes verify only the right PIN', () => {
  const stored = hashPin('2468')
  assert.ok(!stored.includes('2468'))
  assert.ok(checkPin('2468', stored))
  assert.ok(!checkPin('1357', stored))
  assert.ok(!checkPin('2468', ''))
})

test('sessions: login, expiry, and lockout after repeated wrong PINs', () => {
  const stored = hashPin('2468')
  const s = new Sessions({ ttlMs: 1000, maxFails: 3, lockMs: 60_000 })
  const { token } = s.login('2468', stored, 0)
  assert.ok(s.valid(token, 500))
  assert.ok(!s.valid(token, 2000), 'expired')
  for (let i = 0; i < 3; i++) assert.equal(s.login('0000', stored, 10).error, 'Wrong PIN.')
  assert.match(s.login('2468', stored, 20).error, /Too many/)
  assert.ok(s.login('2468', stored, 70_000).token, 'unlocked after the wait')
})
