// Keeps a record of the recorder's life in logs/, so gaps in recording can be explained later:
//  - everything printed also goes to logs/recorder-YYYY-MM-DD.log (kept 30 days)
//  - at start: when the laptop booted, and how the previous run ended (clean stop, or
//    killed / crashed / power lost, with the last time it was seen alive)
//  - while running: when the laptop was asleep or the recorder stalled (timer gaps), plus an hourly status line
//  - at stop: why (Ctrl+C, window closed, crash)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { format } from 'node:util'

const KEEP_LOG_DAYS = 30
const TICK_MS = 30_000
const GAP_MS = 120_000 // a 30s timer firing this late means the laptop was asleep or the recorder stalled

const stamp = (d = new Date()) => d.toLocaleString()
const day = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const ago = (ms) => {
  const m = Math.round(ms / 60000)
  return m < 120 ? `${m} min` : `${(m / 60).toFixed(1)} h`
}

// The log is written in the background (a stream, not appendFileSync): on a busy hard disk
// (e.g. Windows Update installing) a synchronous write can stall for minutes, and with it
// the whole recorder, including the Ring push connection.
let logFile = null
let logStream = null

/** Write what's still buffered in the log, waiting at most `ms` (the disk may be stalled). */
export function flushLog(ms = 3000) {
  if (!logStream) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref()
    logStream.end(resolve)
  })
}

/** Copy all console output into a daily log file. Returns the logs directory. */
export function startFileLog(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true })
  for (const f of fs.readdirSync(logsDir)) {
    const m = f.match(/^recorder-(\d{4}-\d{2}-\d{2})\.log$/)
    if (m && Date.now() - new Date(m[1]).getTime() > KEEP_LOG_DAYS * 86400_000) fs.rmSync(path.join(logsDir, f), { force: true })
  }
  const append = (line) => {
    const file = path.join(logsDir, `recorder-${day()}.log`)
    if (file !== logFile) {
      logStream?.end()
      logFile = file
      logStream = fs.createWriteStream(file, { flags: 'a' })
      logStream.on('error', () => {}) // never let logging stop the recorder
    }
    logStream.write(line)
  }
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      original(...args)
      try { append(format(...args) + '\n') } catch {}
    }
  }
  return logsDir
}

/**
 * Logs start, stop, sleep and the previous run's ending. `status()` may return a string
 * for the hourly status line (e.g. push connection health).
 */
export function trackLifecycle(logsDir, log, { status } = {}) {
  const stateFile = path.join(logsDir, 'state.json')
  const write = (s) => { try { fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)) } catch {} }
  // While running, update it in the background and skip a tick if the last write is still waiting.
  let writing = false
  const writeLater = (s) => {
    if (writing) return
    writing = true
    fs.writeFile(stateFile, JSON.stringify(s, null, 2), () => { writing = false })
  }

  let prev = null
  try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {}

  const bootedAt = new Date(Date.now() - os.uptime() * 1000)
  log(`=== recorder started (pid ${process.pid}). Laptop booted ${stamp(bootedAt)} (${ago(os.uptime() * 1000)} ago).`)
  if (prev?.lastAlive) {
    const last = new Date(prev.lastAlive)
    if (prev.stoppedAt) {
      log(`previous run (pid ${prev.pid}) stopped ${stamp(new Date(prev.stoppedAt))}: ${prev.stopReason}`)
    } else if (last < bootedAt) {
      log(`previous run (pid ${prev.pid}) was still running when the laptop shut down or restarted; last seen alive ${stamp(last)}`)
    } else {
      log(`previous run (pid ${prev.pid}) ended without a clean stop (killed, crashed or window closed); last seen alive ${stamp(last)}`)
    }
    log(`not recording from ${stamp(last)} until now (${ago(Date.now() - last)})`)
  }

  const state = { pid: process.pid, startedAt: new Date().toISOString(), lastAlive: new Date().toISOString() }
  write(state)

  let lastTick = Date.now()
  let lastStatus = Date.now()
  setInterval(() => {
    const now = Date.now()
    if (now - lastTick > GAP_MS) {
      log(`laptop was asleep or the recorder was stalled (e.g. disk busy with Windows Update) from ${stamp(new Date(lastTick))} to ${stamp(new Date(now))} (${ago(now - lastTick)}): nothing recorded then`)
    }
    lastTick = now
    state.lastAlive = new Date(now).toISOString()
    writeLater(state)
    if (now - lastStatus >= 3600_000) {
      lastStatus = now
      log(`status: running ${ago(now - new Date(state.startedAt))}${status ? '; ' + status() : ''}`)
    }
  }, TICK_MS).unref()

  let stopping = false
  const stop = (reason, code = 0) => {
    if (stopping) return
    stopping = true
    log(`=== recorder stopping: ${reason}`)
    write({ ...state, lastAlive: new Date().toISOString(), stoppedAt: new Date().toISOString(), stopReason: reason })
    flushLog().then(() => process.exit(code))
  }
  // windows\stop-recorder.bat drops this file; exit code 3 tells start-doorbell.bat not to restart.
  const stopFile = path.join(logsDir, 'stop-request')
  fs.rmSync(stopFile, { force: true })
  setInterval(() => {
    fs.rm(stopFile, (err) => { if (!err) stop('asked to stop (stop-recorder.bat)', 3) })
  }, 2000).unref()

  process.on('SIGINT', () => stop('Ctrl+C'))
  process.on('SIGTERM', () => stop('asked to stop (SIGTERM)'))
  process.on('SIGBREAK', () => stop('Ctrl+Break'))
  process.on('SIGHUP', () => stop('window closed, or Windows signing out / shutting down'))
  process.on('uncaughtException', (e) => {
    log('CRASH:', e?.stack || e)
    stop(`crashed: ${e?.message || e}`, 1)
  })
  process.on('unhandledRejection', (e) => {
    log('CRASH (unhandled promise):', e?.stack || e)
    stop(`crashed: ${e?.message || e}`, 1)
  })
  return { stop }
}
