import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { ENV_KEYS, updateEnvText } from '../src/config.js'

test('updateEnvText replaces values, keeps comments, quotes spaces, appends new keys', () => {
  const text = 'KEEP_DAYS=14          # delete old\nRECORD_ON=ding,motion\n'
  const out = updateEnvText(text, { KEEP_DAYS: 3, RECORD_ON: 'ding', RECORDINGS_PATH: '/Volumes/My Disk/doorbell' })
  assert.equal(out, 'KEEP_DAYS=3          # delete old\nRECORD_ON=ding\nRECORDINGS_PATH="/Volumes/My Disk/doorbell"\n')
})

test('ENV_KEYS names every setting the app reads, so npm test can leave them out', () => {
  const src = path.join(import.meta.dirname, '..', 'src')
  const read = new Set()
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(src, f), 'utf8')
    for (const m of text.matchAll(/(?:process\.env\.|process\.env\[['"]|\b(?:env|list)\(['"])([A-Z][A-Z0-9_]+)/g)) read.add(m[1])
  }
  const own = [...read].filter((k) => !k.startsWith('DOORBELL_')) // the app's own switches, not settings
  assert.ok(own.length > 10)
  assert.deepEqual(own.filter((k) => !ENV_KEYS.includes(k)), [])
})
