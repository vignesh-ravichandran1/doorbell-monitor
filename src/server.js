// Serves the clips page, its data (/api/clips), and the clip files themselves. Supports
// Range requests so videos can seek (iPhone Safari refuses to play mp4 without it).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clipSummary } from './storage.js'

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web', 'index.html')
const TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }

function sendFile(req, res, file, type) {
  const { size } = fs.statSync(file)
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

export function startServer(root, port, { maxStorageGb = 0, keepDays = 0 } = {}, log = console.log) {
  const server = http.createServer((req, res) => {
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
      const body = JSON.stringify({ ...clipSummary(root), capBytes: maxStorageGb * 1024 ** 3, keepDays })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(body)
    }

    const file = path.join(root, path.normalize(urlPath))
    const rel = path.relative(root, file)
    const type = TYPES[path.extname(file)]
    if (rel.startsWith('..') || path.isAbsolute(rel) || !type || !fs.existsSync(file)) {
      res.writeHead(404).end('Not found')
      return
    }
    sendFile(req, res, file, type)
  })
  server.listen(port, () => log(`clips page: http://localhost:${port}`))
  return server
}
