import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateEnvText } from '../src/config.js'

test('updateEnvText replaces values, keeps comments, quotes spaces, appends new keys', () => {
  const text = 'KEEP_DAYS=14          # delete old\nRECORD_ON=ding,motion\n'
  const out = updateEnvText(text, { KEEP_DAYS: 3, RECORD_ON: 'ding', RECORDINGS_PATH: '/Volumes/My Disk/doorbell' })
  assert.equal(out, 'KEEP_DAYS=3          # delete old\nRECORD_ON=ding\nRECORDINGS_PATH="/Volumes/My Disk/doorbell"\n')
})
