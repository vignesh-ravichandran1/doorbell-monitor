// npm run rethumb: re-makes the thumbnail of every saved clip with the "most telling frame"
// rule (see thumbnail.js). Safe while the recorder runs: one clip at a time, ffmpeg at
// below-normal priority, and clips changed in the last 3 minutes (maybe still recording) are
// left alone. Old clips don't know when the doorbell rang, so they all use the motion rule.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { config, findFfmpeg } from './config.js'
import { listClips } from './storage.js'
import { makeThumbnail } from './thumbnail.js'

const run = promisify(execFile)
const ffmpeg = await findFfmpeg()
const clips = listClips(config.recordingsDir)
console.log(`Re-making thumbnails for ${clips.length} clips in ${config.recordingsDir}`)
let done = 0
let failed = 0
for (const clip of clips) {
  const rel = path.relative(config.recordingsDir, clip)
  if (Date.now() - fs.statSync(clip).mtimeMs < 3 * 60_000) {
    console.log(`  skip ${rel} (recent, may still be recording)`)
    continue
  }
  try {
    const t = await makeThumbnail(ffmpeg, clip, clip.replace(/\.mp4$/, '.jpg'), { run })
    done++
    console.log(`  ${rel}: frame at ${t.toFixed(1)}s`)
  } catch (e) {
    failed++
    console.log(`  ${rel}: FAILED ${e.message.split('\n')[0]}`)
  }
}
console.log(`Done: ${done} thumbnails made${failed ? `, ${failed} failed` : ''}.`)
