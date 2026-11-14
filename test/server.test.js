// The web server end to end on a temporary folder: a mistake in server.js must fail the
// tests (and so stop a phone update) instead of only showing up when the recorder starts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { startServer } from '../src/server.js'

const get = (port, urlPath, headers = {}) => new Promise((resolve, reject) => {
  http.get({ port, path: urlPath, headers }, (res) => {
    const chunks = []
    res.on('data', (d) => chunks.push(d))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  }).on('error', reject)
})

test('serves the page, the clip list (ETag, gzip), health, and protects settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-srv-'))
  fs.mkdirSync(path.join(root, '2026-01-31'))
  fs.writeFileSync(path.join(root, '2026-01-31', '090000_ding_a.mp4'), Buffer.alloc(2000))
  const config = { maxStorageGb: 1, keepDays: 0 }
  const server = startServer(root, 0, { config }, () => {})
  await new Promise((r) => server.once('listening', r))
  const { port } = server.address()
  try {
    const page = await get(port, '/')
    assert.equal(page.status, 200)
    assert.match(page.body.toString(), /<title>Doorbell<\/title>/)

    const list = await get(port, '/api/clips')
    assert.equal(list.status, 200)
    const data = JSON.parse(list.body)
    assert.equal(data.clips.length, 1)
    assert.equal(data.clips[0].event, 'ding')
    assert.equal(data.capBytes, 1024 ** 3)

    const unchanged = await get(port, '/api/clips', { 'if-none-match': list.headers.etag })
    assert.equal(unchanged.status, 304)
    assert.equal(unchanged.body.length, 0)

    const zipped = await get(port, '/api/clips', { 'accept-encoding': 'gzip' })
    assert.equal(zipped.headers['content-encoding'], 'gzip')

    const clip = await get(port, '/2026-01-31/090000_ding_a.mp4', { range: 'bytes=0-99' })
    assert.equal(clip.status, 206)
    assert.equal(clip.body.length, 100)

    assert.match(JSON.parse((await get(port, '/api/health')).body).level, /ok|starting|problem/)
    assert.equal((await get(port, '/api/settings')).status, 401, 'settings need the PIN')
    assert.equal((await get(port, '/../package.json')).status, 404)
  } finally {
    server.close()
  }
})
