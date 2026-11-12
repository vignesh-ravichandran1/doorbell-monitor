// Records one clip from a camera's live view. The ClipSession decides when to stop, so
// new activity can extend the same clip.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { firstValueFrom } from 'rxjs'
import { clipPath } from './storage.js'
import { makeThumbnail } from './thumbnail.js'

const run = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until ffmpeg has finished writing the MP4 (size stable and the index present). */
export async function waitForFinishedMp4(file, timeoutMs = 30_000) {
  let lastSize = -1
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    await sleep(1000)
    const size = (await fs.promises.stat(file).catch(() => null))?.size
    if (size === undefined) continue
    if (size === lastSize && size > 0) {
      const fd = await fs.promises.open(file, 'r')
      const { buffer } = await fd.read(Buffer.alloc(Math.min(size, 4 * 1024 * 1024)), 0, Math.min(size, 4 * 1024 * 1024), 0)
        .finally(() => fd.close())
      if (buffer.includes('moov')) return
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
  // -frag_duration: a fragment at least every 0.5 s, not only at keyframes (Ring's can be seconds
  // apart), since whatever is after the last complete fragment is lost when ffmpeg is killed.
  const call = await camera.streamVideo({
    output: ['-t', String(maxClipSeconds + 10), '-flush_packets', '1', '-frag_duration', '500000',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', clip],
  })
  // Count the clip's length from when video actually starts arriving, not from when it was
  // requested: ffmpeg can take a second or two to start (more on Windows), and that time
  // would otherwise come off every clip.
  for (const end = Date.now() + 15_000; Date.now() < end;) {
    if ((await fs.promises.stat(clip).catch(() => null))?.size > 0) break
    await sleep(100)
  }
  session.start()
  let ended = false
  firstValueFrom(call.onCallEnded).then(() => { ended = true })
  // On Windows the kill loses the unfinished last fragment, so record a moment longer.
  const extraMs = process.platform === 'win32' ? 1000 : 0
  while (!ended && Date.now() < session.deadline + extraMs) await sleep(250)
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
  // Rewrite it as a regular MP4 with its index at the front (stream copy, no re-encoding: a
  // second or two). Players then know its length and can jump anywhere at once instead of
  // reading through fragments, which matters most on a phone over Tailscale. If this fails,
  // the fragmented clip is kept: it still plays, it just seeks more slowly.
  const tmp = `${clip}.tmp`
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-map', '0', '-c', 'copy',
    '-movflags', '+faststart', '-f', 'mp4', tmp])
    .then(() => fs.promises.rename(tmp, clip))
    .catch((e) => {
      fs.rmSync(tmp, { force: true })
      log(`could not make ${path.basename(clip)} quick to seek, kept as recorded: ${e.message.split('\n')[0]}`)
    })
  const thumb = clip.replace(/\.mp4$/, '.jpg')
  await makeThumbnail(ffmpeg, clip, thumb, { ringAt: session.ringAt, run }).catch(() => {})
  log(`saved ${path.relative(recordingsDir, clip)} (${Math.round((Date.now() - session.startedAt) / 1000)}s)`)
  return { clip, thumb, started }
}

