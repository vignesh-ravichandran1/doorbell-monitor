// Records one clip from a camera's live view. The ClipSession decides when to stop, so
// new activity can extend the same clip.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { firstValueFrom } from 'rxjs'
import { clipPath } from './storage.js'

const run = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until ffmpeg has finished writing the MP4 (size stable and the index present). */
export async function waitForFinishedMp4(file, timeoutMs = 30_000) {
  let lastSize = -1
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    await sleep(1000)
    if (!fs.existsSync(file)) continue
    const { size } = fs.statSync(file)
    if (size === lastSize && size > 0) {
      const fd = fs.openSync(file, 'r')
      const head = Buffer.alloc(Math.min(size, 4 * 1024 * 1024))
      fs.readSync(fd, head, 0, head.length, 0)
      fs.closeSync(fd)
      if (head.includes('moov')) return
    }
    lastSize = size
  }
}

export async function record(camera, session, { ffmpeg, recordingsDir, maxClipSeconds, log = console.log }) {
  const started = new Date()
  let clip = clipPath(recordingsDir, started, session.event, camera.id)
  fs.mkdirSync(path.dirname(clip), { recursive: true })
  // -t is only a safety net; the session decides when to stop.
  // Fragmented MP4 (index up front, self-contained fragments): ring-client-api stops ffmpeg
  // with kill(), which on Windows terminates it at once, so a normal MP4 never gets its index
  // written and won't play. A fragmented one is playable however ffmpeg ends (crash, power cut).
  // -flush_packets 1 writes each fragment to disk at once instead of keeping it in a buffer.
  const call = await camera.streamVideo({
    output: ['-t', String(maxClipSeconds + 10), '-flush_packets', '1',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', clip],
  })
  session.start()
  let ended = false
  firstValueFrom(call.onCallEnded).then(() => { ended = true })
  while (!ended && Date.now() < session.deadline) await sleep(500)
  call.stop()
  await waitForFinishedMp4(clip)

  if (!fs.existsSync(clip) || fs.statSync(clip).size < 10_000) {
    fs.rmSync(clip, { force: true })
    throw new Error('no video received from the doorbell')
  }
  // A ring during a motion clip makes it a ring clip, so the Rings filter finds it.
  const finalClip = clipPath(recordingsDir, started, session.event, camera.id)
  if (finalClip !== clip) {
    fs.renameSync(clip, finalClip)
    clip = finalClip
  }
  const thumb = clip.replace(/\.mp4$/, '.jpg')
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', clip,
    '-frames:v', '1', '-vf', 'scale=640:-2', thumb]).catch(() => {})
  log(`saved ${path.relative(recordingsDir, clip)} (${Math.round((Date.now() - session.startedAt) / 1000)}s)`)
  return { clip, thumb, started }
}

