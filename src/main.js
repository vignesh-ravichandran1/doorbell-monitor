// Listens for Ring ding/motion events, records a clip of each from the live view,
// purges old clips, and serves a page to watch them. No Ring subscription needed.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { RingApi } from 'ring-client-api'
import { enableDebug, useLogger } from 'ring-client-api/util'
import { filter, firstValueFrom } from 'rxjs'
import { config, findFfmpeg, loadToken, saveToken } from './config.js'
import { startServer } from './server.js'
import { clipPath, prune } from './storage.js'

const log = (...args) => console.log(new Date().toLocaleString(), ...args)
const run = promisify(execFile)

// ring-client-api is silent by default; show its messages (e.g. push connection errors) in our log.
useLogger({
  logInfo: (...m) => log('[ring]', ...m),
  logError: (m) => log('[ring] ERROR', m instanceof Error ? m.message : m),
})
if (process.argv.includes('--debug')) enableDebug()

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

async function record(camera, event, ffmpeg) {
  const started = new Date()
  const clip = clipPath(config.recordingsDir, started, event, camera.id)
  fs.mkdirSync(path.dirname(clip), { recursive: true })
  const call = await camera.streamVideo({
    output: ['-t', String(config.recordSeconds), '-movflags', '+faststart', clip],
  })
  const timeout = new Promise((resolve) => setTimeout(resolve, (config.recordSeconds + 60) * 1000))
  await Promise.race([firstValueFrom(call.onCallEnded), timeout])
  call.stop()

  if (!fs.existsSync(clip) || fs.statSync(clip).size < 10_000) {
    fs.rmSync(clip, { force: true })
    throw new Error('no video received from the doorbell')
  }
  const thumb = clip.replace(/\.mp4$/, '.jpg')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', clip,
    '-frames:v', '1', '-vf', 'scale=640:-2', thumb]).catch(() => {})
  log(`saved ${path.relative(config.recordingsDir, clip)}`)
  return { clip, thumb, started }
}

async function main() {
  const token = loadToken()
  if (!token) {
    console.error('No Ring login yet. Run: npm run setup')
    process.exit(1)
  }
  fs.mkdirSync(config.recordingsDir, { recursive: true })
  housekeeping()
  startServer(config.recordingsDir, config.webPort, { maxStorageGb: config.maxStorageGb, keepDays: config.keepDays }, log)

  const ffmpeg = await findFfmpeg()
  const ring = new RingApi({ refreshToken: token, ffmpegPath: ffmpeg })
  // Ring replaces the token regularly; the old one stops working, so always keep the newest.
  ring.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    saveToken(newRefreshToken)
  })

  const cameras = await ring.getCameras()
  if (!cameras.length) log('no Ring cameras or doorbells found on this account')
  const busy = new Set()
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
    if (!config.recordOn.has(event) || busy.has(camera.id)) return // the clip in progress covers it
    busy.add(camera.id)
    try {
      const { clip, thumb, started } = await record(camera, event, ffmpeg)
      if (config.notifyOn.has(event)) {
        const rel = path.relative(config.recordingsDir, clip).split(path.sep).join('/')
        notify(`${camera.name}: clip saved (${event})`, started.toLocaleTimeString(),
          { priority: 'low', image: thumb, click: config.webBaseUrl ? `${config.webBaseUrl}/${rel}` : undefined })
      }
    } catch (e) {
      log(`recording at ${camera.name} failed:`, e.message)
    } finally {
      busy.delete(camera.id)
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
  process.exit(1)
})
