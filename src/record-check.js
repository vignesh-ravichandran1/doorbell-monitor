// npm run test-clip: checks the two halves of recording separately, with the recorder stopped.
//  1. Records a 15-second clip straight from live view (no ring needed): Ring -> ffmpeg -> disk.
//  2. Listens for 60 seconds while you press the doorbell: are Ring's events reaching this computer?
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { RingApi } from 'ring-client-api'
import { enableDebug, useLogger } from 'ring-client-api/util'
import { ClipSession } from './clip-session.js'
import { config, findFfmpeg, loadToken, saveToken } from './config.js'
import { record } from './recorder.js'

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args)
useLogger({
  logInfo: (...m) => log('[ring]', ...m),
  logError: (m) => log('[ring] ERROR', m instanceof Error ? m.message : m),
})
if (process.argv.includes('--debug')) enableDebug()

const portInUse = (port) => new Promise((resolve) => {
  const srv = net.createServer()
  srv.once('error', () => resolve(true))
  srv.listen(port, () => srv.close(() => resolve(false)))
})

async function main() {
  if (await portInUse(config.webPort)) {
    console.log('The recorder seems to be running (port ' + config.webPort + ' is in use).')
    console.log('Stop it first: in its window press Ctrl+C, type Y, then run this again.')
    process.exit(1)
  }
  const token = loadToken()
  if (!token) {
    console.log('Not logged in to Ring. Run: npm run setup')
    process.exit(1)
  }

  const ffmpeg = await findFfmpeg()
  const ring = new RingApi({ refreshToken: token, ffmpegPath: ffmpeg })
  ring.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => saveToken(newRefreshToken))
  const cameras = await ring.getCameras()
  if (!cameras.length) {
    console.log('No Ring cameras found on this account.')
    process.exit(1)
  }

  let events = 0
  for (const camera of cameras) {
    camera.onNewNotification.subscribe((n) => {
      events++
      log(`EVENT from Ring for ${camera.name}: ${n.android_config?.category ?? 'unknown'}`)
    })
  }

  // 1. Recording, without waiting for an event
  const camera = cameras[0]
  console.log(`\n== Test 1: recording 15 seconds from ${camera.name}'s live view...`)
  let recordingOk = false
  try {
    const session = new ClipSession('test', { dingSeconds: 15, motionSeconds: 15, maxSeconds: 15 })
    fs.mkdirSync(config.recordingsDir, { recursive: true })
    const { clip } = await record(camera, session, { ffmpeg, recordingsDir: config.recordingsDir, maxClipSeconds: 15, log })
    const mb = (fs.statSync(clip).size / 1024 / 1024).toFixed(1)
    console.log(`PASS: saved ${path.relative(config.recordingsDir, clip)} (${mb} MB). It's on the clips page as "Test".`)
    recordingOk = true
  } catch (e) {
    console.log(`FAIL: recording didn't work: ${e.message}`)
  }

  // 2. Events
  console.log('\n== Test 2: PRESS THE DOORBELL BUTTON NOW. Listening for 60 seconds...')
  await new Promise((resolve) => setTimeout(resolve, 60_000))
  console.log(events
    ? `PASS: ${events} event(s) arrived from Ring.`
    : 'FAIL: no events arrived from Ring in 60 seconds.')

  console.log('\n== Summary')
  console.log(`  Recording: ${recordingOk ? 'works' : 'BROKEN'}`)
  console.log(`  Ring events: ${events ? 'arrive' : 'NOT arriving'}`)
  console.log('Copy this whole window into the chat.')
  ring.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
