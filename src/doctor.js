// Checks that this computer can run the recorder, and says how to fix anything that's wrong.
//   npm run doctor           all checks, including the Ring login
//   node src/doctor.js --pre  machine checks only (used by the prepare scripts, before setup)
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { config, envFile, findFfmpeg, loadToken, saveToken } from './config.js'

const run = promisify(execFile)
const GB = 1024 ** 3

const green = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s)
const red = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s)
const yellow = (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s)

function osCheck() {
  const p = process.platform
  const arch = process.arch
  if (p === 'darwin') {
    const major = Number(os.release().split('.')[0]) - 9 // Darwin 20 = macOS 11
    return major >= 11
      ? { ok: true, msg: `macOS ${major} (${arch})` }
      : { ok: false, msg: `macOS ${major} is too old`, fix: 'Needs macOS 11 (Big Sur) or newer.' }
  }
  if (p === 'win32') {
    const build = Number(os.release().split('.')[2])
    if (build < 10240) return { ok: false, msg: 'Windows 7/8 is too old', fix: 'Needs Windows 10 or 11, or install a light Linux (e.g. Linux Mint XFCE).' }
    if (arch !== 'x64') return { ok: false, msg: `32-bit/${arch} Windows`, fix: 'Needs 64-bit Windows 10/11, or install a light 64-bit Linux.' }
    return { ok: true, msg: `Windows ${build >= 22000 ? 11 : 10} (build ${build})` }
  }
  if (p === 'linux' && ['x64', 'arm64', 'arm'].includes(arch)) return { ok: true, msg: `Linux (${arch})` }
  return { ok: false, msg: `${p}/${arch} is not supported`, fix: 'Use macOS, Windows 10/11 (64-bit) or Linux.' }
}

function nodeCheck() {
  const major = Number(process.versions.node.split('.')[0])
  return major >= 22
    ? { ok: true, msg: `Node.js ${process.versions.node}` }
    : { ok: false, msg: `Node.js ${process.versions.node} is too old`, fix: 'Run the prepare script again, or install Node.js 22 LTS from nodejs.org.' }
}

async function ffmpegCheck() {
  const ffmpeg = await findFfmpeg()
  try {
    const { stdout } = await run(ffmpeg, ['-hide_banner', '-decoders'], { maxBuffer: 10 * 1024 * 1024 })
    if (!/\bopus\b/.test(stdout)) return { ok: false, msg: 'ffmpeg has no Opus audio support', fix: 'Run: npm install' }
    return { ok: true, msg: ffmpeg === 'ffmpeg' ? 'ffmpeg (system)' : 'ffmpeg (bundled)' }
  } catch {
    return { ok: false, msg: 'ffmpeg not found', fix: 'Run: npm install   (it downloads ffmpeg; needs internet)' }
  }
}

function storageCheck() {
  const dir = config.recordingsDir
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.write-test')
    fs.writeFileSync(probe, 'ok')
    fs.rmSync(probe)
  } catch (e) {
    return { ok: false, msg: `can't write to ${dir}`, fix: 'Plug in / unlock the disk, or change RECORDINGS_PATH in .env (npm run setup).' }
  }
  const s = fs.statfsSync(dir)
  const free = (s.bavail * s.bsize) / GB
  const need = config.maxStorageGb + config.minFreeGb
  const msg = `recordings: ${dir} (${free.toFixed(1)} GB free)`
  if (config.maxStorageGb > 0 && free < need) {
    return { ok: true, warn: true, msg, fix: `Less free space than MAX_STORAGE_GB + MIN_FREE_GB (${need} GB). Clips will be purged earlier; lower MAX_STORAGE_GB to silence this.` }
  }
  return { ok: true, msg }
}

function portCheck() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve({ ok: true, warn: true, msg: `port ${config.webPort} is in use`, fix: 'Fine if the recorder is already running; otherwise set WEB_PORT in .env to another number, e.g. 8081.' }))
    srv.listen(config.webPort, () => srv.close(() => resolve({ ok: true, msg: `port ${config.webPort} is free for the clips page` })))
  })
}

async function internetCheck() {
  try {
    await fetch('https://oauth.ring.com/', { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    return { ok: true, msg: 'can reach Ring' }
  } catch {
    return { ok: false, msg: "can't reach Ring (oauth.ring.com)", fix: 'Check the internet connection, VPN or firewall.' }
  }
}

function envCheck() {
  return fs.existsSync(envFile)
    ? { ok: true, msg: '.env settings file found' }
    : { ok: false, msg: 'no .env settings file', fix: 'Run: npm run setup' }
}

async function ringCheck() {
  const token = loadToken()
  if (!token) return { ok: false, msg: 'not logged in to Ring', fix: 'Run: npm run setup' }
  const { RingApi } = await import('ring-client-api')
  const ring = new RingApi({ refreshToken: token })
  ring.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => saveToken(newRefreshToken))
  try {
    const cameras = await Promise.race([
      ring.getCameras(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 45000)),
    ])
    if (!cameras.length) return { ok: false, msg: 'logged in, but no doorbells/cameras on this Ring account', fix: 'Log in with the account that owns the doorbell: npm run setup' }
    return { ok: true, msg: `Ring login works, found: ${cameras.map((c) => c.name).join(', ')}` }
  } catch (e) {
    return { ok: false, msg: `Ring login failed (${e.message})`, fix: 'Log in again: npm run setup' }
  } finally {
    ring.disconnect()
  }
}

export async function runChecks({ pre = false } = {}) {
  const checks = [
    ['Operating system', osCheck],
    ['Node.js', nodeCheck],
    ['ffmpeg', ffmpegCheck],
    ['Internet', internetCheck],
    ['Storage', storageCheck],
    ['Web port', portCheck],
    ...(pre ? [] : [['Settings', envCheck], ['Ring', ringCheck]]),
  ]
  let failed = 0
  console.log('\nChecking this computer...\n')
  for (const [name, check] of checks) {
    const r = await check()
    const [y, n, w] = process.platform === 'win32' ? ['[OK]', '[X]', '[!]'] : ['✓', '✗', '!'] // old Windows consoles lack ✓✗
    const mark = !r.ok ? red(n) : r.warn ? yellow(w) : green(y)
    console.log(`  ${mark} ${name.padEnd(16)} ${r.msg}`)
    if (r.fix) console.log(`      ${' '.repeat(16)} → ${r.fix}`)
    if (!r.ok) failed++
  }
  console.log(failed ? red(`\n${failed} problem(s) found. Fix the problems marked above and run this again.\n`) : green('\nAll good.\n'))
  return failed === 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runChecks({ pre: process.argv.includes('--pre') }).then((ok) => process.exit(ok ? 0 : 1))
}
