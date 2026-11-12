import assert from 'node:assert/strict'
import { test } from 'node:test'
import { originAllowed } from '../src/passkeys.js'

test('Face ID only on https (or localhost) pages of the expected address', () => {
  assert.ok(originAllowed('https://doorbell.tail1234.ts.net', 'doorbell.tail1234.ts.net'))
  assert.ok(originAllowed('http://localhost:8080', 'localhost'))
  assert.ok(!originAllowed('http://doorbell.tail1234.ts.net', 'doorbell.tail1234.ts.net'), 'plain http')
  assert.ok(!originAllowed('https://evil.example', 'doorbell.tail1234.ts.net'), 'other site')
  assert.ok(!originAllowed('http://192.168.2.91:8080', '192.168.2.91'), 'LAN address over http')
  assert.ok(!originAllowed('not a url', 'localhost'))
})
