// Serves the clips page, its data (/api/clips), and the clip files themselves. Supports
// Range requests so videos can seek (iPhone Safari refuses to play mp4 without it).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { FIELDS, Sessions, applySettings, currentSettings, pendingRestart, storedPinHash, validateSettings } from './settings.js'
import { clipSummary } from './storage.js'

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'index.html')
const TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }

// Everything here is async: on a busy hard disk a synchronous stat or read can stall the whole
// recorder, not just this request.
async function sendFile(req, res, file, type) {
  const stat = await fs.promises.stat(file).catch(() => null)
  if (!stat?.isFile()) {
    res.writeHead(404).end('Not found')
    return
  }
  const { size } = stat
  // The ETag changes when the file does (a clip still recording, or rewritten once finished), so
  // browsers re-check each time but only download again when something changed.
  const etag = `"${size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`
  // Thumbnails never change once made: keep them a week. Clips: re-check each time (cheap).
  const cache = type === 'image/jpeg' ? 'private, max-age=604800' : 'no-cache'
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ETag: etag, 'Last-Modified': stat.mtime.toUTCString() }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end()
    return
  }
  if (type.startsWith('text/html') && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const body = zlib.gzipSync(await fs.promises.readFile(file))
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  const ifRange = req.headers['if-range']
  if (range && (range[1] || range[2]) && (!ifRange || ifRange === etag)) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return reject(new Error('Expected JSON'))
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 20_000) req.destroy()
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('Bad JSON')) }
    })
    req.on('error', reject)
  })
}

const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)
const SESSION_COOKIE = 'doorbell_session'

/** Settings API: PIN login, then read/change settings. Changes apply live where possible. */
async function settingsApi(req, res, urlPath, { config, sessions, onSettingsChanged }) {
  const token = cookie(req, SESSION_COOKIE)
  if (urlPath === '/api/login' && req.method === 'POST') {
    const { pin } = await readJson(req)
    const result = sessions.login(pin, storedPinHash())
    if (result.error) return json(res, 401, { error: result.error })
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}`,
    })
  }
  if (urlPath === '/api/logout' && req.method === 'POST') {
    sessions.logout(token)
    return json(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0` })
  }
  if (urlPath !== '/api/settings') return json(res, 404, { error: 'Not found' })
  if (!sessions.valid(token)) return json(res, 401, { error: 'login', pinSet: Boolean(storedPinHash()) })

  if (req.method === 'GET') {
    return json(res, 200, { settings: currentSettings(config), fields: FIELDS, restart: pendingRestart(config) })
  }
  if (req.method === 'PUT') {
    const { values, errors } = validateSettings(await readJson(req), config)
    if (Object.keys(errors).length) return json(res, 400, { errors })
    const restart = applySettings(values, config)
    if (Object.keys(values).length) onSettingsChanged?.(Object.keys(values))
    return json(res, 200, { saved: Object.keys(values), restart, settings: currentSettings(config) })
  }
  return json(res, 405, { error: 'Method not allowed' })
}

export function startServer(root, port, { config = { maxStorageGb: 0, keepDays: 0 }, onSettingsChanged } = {}, log = console.log) {
  const sessions = new Sessions()
  const handle = async (req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    } catch {
      res.writeHead(400).end()
      return
    }

    if (urlPath === '/' || urlPath === '/index.html') {
      return sendFile(req, res, PAGE, 'text/html; charset=utf-8')
    }
    if (urlPath === '/api/clips') {
      return json(res, 200, { ...(await clipSummary(root)), capBytes: config.maxStorageGb * 1024 ** 3, keepDays: config.keepDays })
    }
    if (urlPath.startsWith('/api/')) {
      try {
        return await settingsApi(req, res, urlPath, { config, sessions, onSettingsChanged })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }

    const file = path.join(root, path.normalize(urlPath))
    const rel = path.relative(root, file)
    const type = TYPES[path.extname(file)]
    if (rel.startsWith('..') || path.isAbsolute(rel) || !type) {
      res.writeHead(404).end('Not found')
      return
    }
    return sendFile(req, res, file, type)
  }
  const server = http.createServer((req, res) => handle(req, res).catch((e) => {
    log(`clips page error for ${req.url}: ${e.message}`)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }))
  server.listen(port, () => log(`clips page: http://localhost:${port}`))
  return server
}
