// Listens for Ring ding/motion events, records a clip of each from the live view,
// purges old clips, and serves a page to watch them. No Ring subscription needed.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { RingApi } from 'ring-client-api'
import { enableDebug, useLogger } from 'ring-client-api/util'
import { filter } from 'rxjs'
import { ClipSession } from './clip-session.js'
import { record } from './recorder.js'
import { watchPush } from './push-debug.js'
import { APP_DIR, config, findFfmpeg, loadToken, saveToken } from './config.js'
import { flushLog, startFileLog, trackLifecycle } from './lifecycle.js'
import { startServer } from './server.js'
import { prune } from './storage.js'

const log = (...args) => console.log(new Date().toLocaleString(), ...args)
const debug = process.argv.includes('--debug') || process.env.DEBUG_LOG === '1'
const portInUse = (port) => new Promise((resolve) => {
  const srv = net.createServer()
  srv.once('error', () => resolve(true))
  srv.listen(port, () => srv.close(() => resolve(false)))
})
const logsDir = startFileLog(path.join(APP_DIR, 'logs'))

// ring-client-api is silent by default; show its messages (e.g. push connection errors) in our log.
useLogger({
  logInfo: (...m) => log('[ring]', ...m),
  logError: (m) => log('[ring] ERROR', m instanceof Error ? m.message : m),
})
if (debug) enableDebug()
const pushStatus = watchPush(log, { verbose: debug })
// One recorder per computer: a second one would share the same Ring push connection and the two
// would knock each other off it. Exit code 3 = don't restart (see windows/start-doorbell.bat).
if (await portInUse(config.webPort)) {
  log(`another recorder is already running (port ${config.webPort} in use); this one exits`)
  await flushLog()
  process.exit(3)
}
trackLifecycle(logsDir, log, { status: pushStatus })
if (debug) log('debug logging on')

async function notify(title, message, { priority = 'default', image, click } = {}) {
  if (!config.ntfyTopic) return
  const headers = { Title: title, Priority: priority, Tags: 'door' }
  if (config.ntfyToken) headers.Authorization = `Bearer ${config.ntfyToken}`
  if (click) headers.Click = click
  let body = message
  if (image && fs.existsSync(image)) {
    headers.Message = message
    headers.Filename = path.basename(image)
    body = fs.readFileSync(image)
  }
  try {
    await fetch(`${config.ntfyUrl}/${config.ntfyTopic}`, { method: 'PUT', headers, body })
  } catch (e) {
    log('notification failed:', e.message)
  }
}

function housekeeping() {
  try {
    prune(config.recordingsDir, { ...config, log })
  } catch (e) {
    log('housekeeping failed:', e.message)
  }
}

async function main() {
  const token = loadToken()
  if (!token) {
    console.error('No Ring login yet. Run: npm run setup')
    await flushLog()
    process.exit(1)
  }
  fs.mkdirSync(config.recordingsDir, { recursive: true })
  housekeeping()
  startServer(config.recordingsDir, config.webPort, {
    config,
    onSettingsChanged: (keys) => {
      log(`settings changed from the web page: ${keys.join(', ')}`)
      housekeeping() // a smaller storage limit takes effect right away
    },
  }, log)

  const ffmpeg = await findFfmpeg()
  const ring = new RingApi({ refreshToken: token, ffmpegPath: ffmpeg })
  // Ring replaces the token regularly; the old one stops working, so always keep the newest.
  ring.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    saveToken(newRefreshToken)
  })

  const cameras = await ring.getCameras()
  if (!cameras.length) log('no Ring cameras or doorbells found on this account')
  const recording = new Map() // camera id -> ClipSession in progress
  const lastMotionAlert = new Map()

  const handle = async (camera, event) => {
    log(`${event} at ${camera.name}`)
    if (config.notifyOn.has(event)) {
      const now = Date.now()
      const quiet = event === 'motion' && now - (lastMotionAlert.get(camera.id) ?? 0) < config.motionCooldownSeconds * 1000
      if (!quiet) {
        if (event === 'motion') lastMotionAlert.set(camera.id, now)
        notify(`${camera.name}: ${event === 'ding' ? 'Someone rang the doorbell' : 'Motion at the door'}`,
          'Recording a clip now', { priority: event === 'ding' ? 'high' : 'default', click: config.webBaseUrl || undefined })
      }
    }
    if (!config.recordOn.has(event)) return
    const current = recording.get(camera.id)
    if (current) {
      current.extend(event) // keep recording the same visit instead of starting a new clip
      log(`${event} during recording: clip extended to ${current.wanted}s`)
      return
    }
    const session = new ClipSession(event, {
      dingSeconds: config.recordSecondsDing,
      motionSeconds: config.recordSecondsMotion,
      maxSeconds: config.maxClipSeconds,
    })
    recording.set(camera.id, session)
    try {
      const { clip, thumb, started } = await record(camera, session, { ffmpeg, recordingsDir: config.recordingsDir, maxClipSeconds: config.maxClipSeconds, log })
      event = session.event
      if (config.notifyOn.has(event)) {
        const rel = path.relative(config.recordingsDir, clip).split(path.sep).join('/')
        notify(`${camera.name}: clip saved (${event})`, started.toLocaleTimeString(),
          { priority: 'low', image: thumb, click: config.webBaseUrl ? `${config.webBaseUrl}/${rel}` : undefined })
      }
    } catch (e) {
      log(`recording at ${camera.name} failed:`, e.message)
    } finally {
      recording.delete(camera.id)
      housekeeping()
    }
  }

  for (const camera of cameras) {
    log(`watching ${camera.name}`)
    // Every ding/motion notification Ring sends, before any filtering, to make problems visible.
    camera.onNewNotification.subscribe((n) =>
      log(`notification from Ring for ${camera.name}: ${n.android_config?.category ?? 'unknown'}`))
    camera.onDoorbellPressed.subscribe(() => handle(camera, 'ding'))
    camera.onMotionDetected.pipe(filter(Boolean)).subscribe(() => handle(camera, 'motion'))
  }
  setInterval(housekeeping, 3600_000)
  log('waiting for rings and motion (ring the doorbell to test)...')
}

main().catch((e) => {
  console.error(e)
  flushLog().then(() => process.exit(1))
})
