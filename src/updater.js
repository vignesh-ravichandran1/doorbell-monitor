// One-tap updates from the Settings page. Only ever takes this repository's own newer commits
// (fast-forward only), installs and tests them, and rolls back if anything fails. After a
// restart, update-guard.js rolls back too if the new version never comes up healthy.
// Node built-ins only: the guard runs this before the app (and its dependencies) loads.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE = path.join(APP_DIR, 'data', 'update.json') // an update waiting to prove it works
const ROLLED_BACK = path.join(APP_DIR, 'data', 'update-rolled-back.json')
const isWin = process.platform === 'win32'
// Files cmd.exe is executing while the recorder runs; changing them mid-run is unsafe.
const LAUNCHERS = ['windows/start-doorbell.bat']
const MAX_STARTS = 3
const HEALTHY_WITHIN_MS = 10 * 60_000

const exec = promisify(execFile)
const run = (cmd, args, opts = {}) =>
  exec(cmd, args, { cwd: APP_DIR, maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60_000, windowsHide: true, ...opts })

function gitPath() {
  const programFiles = 'C:\\Program Files\\Git\\cmd\\git.exe'
  return isWin && fs.existsSync(programFiles) ? programFiles : 'git'
}

// The recorder runs as SYSTEM on Windows while the folder belongs to the user, which git
// refuses ("dubious ownership") unless this folder is named as safe.
const git = async (...args) =>
  (await run(gitPath(), ['-c', `safe.directory=${APP_DIR.replace(/\\/g, '/')}`, ...args])).stdout.trim()

// Fixed arguments only, so running npm through the shell on Windows (needed for npm.cmd) is safe.
const npm = (args) => (isWin ? run('npm.cmd', args, { shell: true }) : run('npm', args))

const tail = (e) => `${e.stdout || ''}\n${e.stderr || ''}`.trim().split('\n').slice(-8).join('\n') || e.message

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export async function version() {
  try {
    const [commit, subject, date] = (await git('log', '-1', '--format=%h%x09%s%x09%cI')).split('\t')
    return { commit, subject, date }
  } catch {
    return { commit: null, error: 'This folder is not a git checkout, so it can\'t update itself. See SETUP.md → Updating.' }
  }
}

/** What an update would bring, and whether it can be done from the page. */
export async function check() {
  const current = await version()
  if (!current.commit) return { current, behind: 0, commits: [], canUpdate: false, reason: current.error }
  try {
    await git('fetch', '--quiet', 'origin')
  } catch (e) {
    return { current, behind: 0, commits: [], canUpdate: false, reason: `Couldn't reach GitHub: ${tail(e)}` }
  }
  let upstream
  try {
    upstream = await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  } catch {
    return { current, behind: 0, commits: [], canUpdate: false, reason: 'This branch has no upstream on GitHub.' }
  }
  const behind = Number(await git('rev-list', '--count', 'HEAD..@{u}'))
  const ahead = Number(await git('rev-list', '--count', '@{u}..HEAD'))
  const log = behind ? await git('log', '--format=%h%x09%s', 'HEAD..@{u}') : ''
  const commits = log ? log.split('\n').map((l) => { const [hash, subject] = l.split('\t'); return { hash, subject } }) : []
  const changed = behind ? (await git('diff', '--name-only', 'HEAD', '@{u}')).split('\n') : []
  const dirty = await git('status', '--porcelain', '--untracked-files=no')

  let reason = null
  if (!behind) reason = 'Already up to date.'
  else if (ahead) reason = `This laptop has ${ahead} change(s) that aren't on GitHub, so it won't update itself. Update it at the laptop.`
  else if (dirty) reason = 'Some app files were edited on this laptop, so it won\'t update itself. Update it at the laptop.'
  else if (changed.some((f) => LAUNCHERS.includes(f))) reason = 'This update changes the Windows start script, which can\'t be replaced while it runs. Update at the laptop: git pull, npm install, then windows\\start-at-boot.bat.'
  return { current, upstream, behind, commits, canUpdate: !reason, reason }
}

let busy = false

/** Pull, install and test; roll back on any failure. Returns { from, to }. */
export async function apply(log = console.log) {
  if (busy) throw new Error('An update is already running.')
  busy = true
  try {
    const status = await check()
    if (!status.canUpdate) throw new Error(status.reason)
    const from = await git('rev-parse', 'HEAD')
    await git('merge', '--ff-only', '@{u}')
    const to = await git('rev-parse', 'HEAD')
    try {
      await npm(['install', '--no-audit', '--no-fund'])
      await npm(['test'])
    } catch (e) {
      log(`update to ${to.slice(0, 7)} failed its checks; rolling back to ${from.slice(0, 7)}`)
      await git('reset', '--hard', from)
      await npm(['install', '--no-audit', '--no-fund']).catch(() => {})
      throw new Error(`The update failed its checks and was undone. Details:\n${tail(e)}`)
    }
    writeJson(STATE, { from, to, at: Date.now(), starts: 0 })
    fs.rmSync(ROLLED_BACK, { force: true })
    return { from: from.slice(0, 7), to: to.slice(0, 7) }
  } finally {
    busy = false
  }
}

/** Called once the new version has been up and connected for a while. */
export function markHealthy(log = console.log) {
  const state = readJson(STATE)
  if (!state) return
  fs.rmSync(STATE, { force: true })
  log(`update to ${state.to.slice(0, 7)} is working`)
}

/**
 * Run before every start (windows\start-doorbell.bat). If the last update keeps failing to
 * start, or never became healthy, go back to the version before it.
 */
export async function guard(log = console.log, now = Date.now()) {
  const state = readJson(STATE)
  if (!state) return 'none'
  state.starts++
  if (state.starts <= MAX_STARTS && now - state.at < HEALTHY_WITHIN_MS) {
    writeJson(STATE, state)
    return 'waiting'
  }
  log(`update to ${state.to.slice(0, 7)} did not start properly; going back to ${state.from.slice(0, 7)}`)
  await git('reset', '--hard', state.from)
  await npm(['install', '--no-audit', '--no-fund']).catch(() => {})
  fs.rmSync(STATE, { force: true })
  writeJson(ROLLED_BACK, { from: state.to.slice(0, 7), to: state.from.slice(0, 7), at: now })
  return 'rolled back'
}

/** A rollback the page should mention, if one happened. */
export const lastRollback = () => readJson(ROLLED_BACK)
