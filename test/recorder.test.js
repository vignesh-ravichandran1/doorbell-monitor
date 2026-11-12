// End-to-end recording with a fake doorbell: ffmpeg streams generated video, and stop()
// behaves like ring-client-api (reports "ended" at once, then ffmpeg finishes the file).
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ReplaySubject } from 'rxjs'
import { ClipSession } from '../src/clip-session.js'
import { findFfmpeg } from '../src/config.js'
import { record } from '../src/recorder.js'

const ffmpeg = await findFfmpeg()

function fakeCamera() {
  return {
    id: 'fake',
    async streamVideo({ output }) {
      const onCallEnded = new ReplaySubject(1)
      const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '45', ...output]) // keyframe every 3 s, like Ring
      ff.on('exit', () => onCallEnded.next())
      // Like ring-client-api on Windows: report 'ended' at once and kill ffmpeg outright, so it
      // can't finish the file. The clip must still play and be (nearly) full length.
      return { onCallEnded, stop: () => { onCallEnded.next(); ff.kill('SIGKILL') } }
    },
  }
}

// Seconds of video, from the "time=" ffmpeg reports after decoding the whole file.
function duration(file) {
  const { stderr } = spawnSync(ffmpeg, ['-i', file, '-f', 'null', '-'], { encoding: 'utf8' })
  return stderr.match(/time=([\d:.]+)/g).pop().slice(5).split(':').reduce((a, v) => a * 60 + Number(v), 0)
}

test('a ring during a motion clip extends it and makes it a ring clip', { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-rec-'))
  const session = new ClipSession('motion', { dingSeconds: 6, motionSeconds: 3, maxSeconds: 8 })
  setTimeout(() => session.extend('ding'), 1500)
  const { clip, thumb } = await record(fakeCamera(), session, { ffmpeg, recordingsDir: dir, maxClipSeconds: 8, log: () => {} })

  assert.match(path.basename(clip), /^\d{6}_ding_fake\.mp4$/)
  assert.ok(fs.existsSync(thumb), 'thumbnail made')
  const secs = duration(clip)
  assert.ok(secs > 6.5 && secs < 9, `clip is ${secs}s, expected ~7.5s (~8.5s on Windows)`)
  assert.deepEqual(fs.readdirSync(path.dirname(clip)).filter((f) => !f.endsWith('.jpg')), [path.basename(clip)], 'renamed, not copied; no temp file left')
  const head = fs.readFileSync(clip).subarray(0, 64 * 1024)
  assert.ok(head.includes('moov') && !fs.readFileSync(clip).includes('moof'), 'regular MP4 with its index at the front')
})
