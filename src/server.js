// Tiny static file server for the recordings folder. Supports Range requests so
// videos can seek (iPhone Safari refuses to play mp4 without it).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const TYPES = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }

export function startServer(root, port, log = console.log) {
  const server = http.createServer((req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    } catch {
      res.writeHead(400).end()
      return
    }
    if (urlPath === '/') urlPath = '/index.html'
    const file = path.join(root, path.normalize(urlPath))
    const rel = path.relative(root, file)
    const type = TYPES[path.extname(file)]
    if (rel.startsWith('..') || path.isAbsolute(rel) || !type || !fs.existsSync(file)) {
      res.writeHead(404).end('Not found')
      return
    }

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
  })
  server.listen(port, () => log(`clips page: http://localhost:${port}`))
  return server
}
