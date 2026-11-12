// The updater against throwaway git repos: a bare "GitHub" and a "laptop" clone that runs
// its own copy of src/updater.js (it updates the folder it lives in).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const sh = (cwd, cmd, ...args) => execFileSync(cmd, args, { cwd, env, stdio: 'pipe' }).toString().trim()
const quiet = () => {}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-upd-'))
  const origin = path.join(dir, 'origin.git')
  const work = path.join(dir, 'work') // where new versions are made and pushed
  const laptop = path.join(dir, 'laptop')
  sh(dir, 'git', 'init', '-q', '--bare', '-b', 'master', origin)
  sh(dir, 'git', 'clone', '-q', origin, work)
  fs.mkdirSync(path.join(work, 'src'))
  fs.mkdirSync(path.join(work, 'windows'))
  fs.copyFileSync(path.join(ROOT, 'src', 'updater.js'), path.join(work, 'src', 'updater.js'))
  fs.writeFileSync(path.join(work, 'windows', 'start-doorbell.bat'), 'rem v1\n')
  fs.writeFileSync(path.join(work, '.gitignore'), 'data/\n')
  writePkg(work, 'node -e 0')
  commit(work, 'v1')
  sh(dir, 'git', 'clone', '-q', origin, laptop)
  return { work, laptop }
}
const writePkg = (dir, testCmd) =>
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: { test: testCmd } }))
function commit(dir, msg) {
  sh(dir, 'git', 'add', '-A')
  sh(dir, 'git', 'commit', '-q', '-m', msg)
  sh(dir, 'git', 'push', '-q', 'origin', 'HEAD:master')
}
const updaterOf = (laptop) => import(`${pathToFileURL(path.join(laptop, 'src', 'updater.js')).href}?${Math.random()}`)
const head = (dir) => sh(dir, 'git', 'rev-parse', '--short', 'HEAD')
const subject = (dir) => sh(dir, 'git', 'log', '-1', '--format=%s')

test('check lists new commits; apply fast-forwards, installs, tests and records it', { timeout: 120_000 }, async () => {
  const { work, laptop } = setup()
  fs.writeFileSync(path.join(work, 'feature.txt'), 'new')
  commit(work, 'Add a feature')
  const u = await updaterOf(laptop)
  const status = await u.check()
  assert.equal(status.behind, 1)
  assert.equal(status.canUpdate, true, status.reason)
  assert.deepEqual(status.commits.map((c) => c.subject), ['Add a feature'])

  const before = head(laptop)
  const { from, to } = await u.apply(quiet)
  assert.equal(from, before)
  assert.equal(to, head(laptop))
  assert.equal(subject(laptop), 'Add a feature')
  assert.ok(fs.existsSync(path.join(laptop, 'data', 'update.json')), 'waits for the new version to prove itself')
  u.markHealthy(quiet)
  assert.ok(!fs.existsSync(path.join(laptop, 'data', 'update.json')))
  assert.equal((await u.check()).reason, 'Already up to date.')
})

test('an update whose tests fail is undone', { timeout: 120_000 }, async () => {
  const { work, laptop } = setup()
  fs.writeFileSync(path.join(work, 'fail.js'), "console.log('ok 1 - fine\\nnot ok 2 - clip test\\n  error: boom\\n  location: x.js:1'); process.exit(1)")
  writePkg(work, 'node fail.js')
  commit(work, 'Broken update')
  const u = await updaterOf(laptop)
  const before = head(laptop)
  await assert.rejects(u.apply(quiet), (e) => {
    assert.match(e.message, /failed its checks and was undone/)
    assert.match(e.message, /not ok 2 - clip test/, 'names the failing test')
    assert.match(e.message, /error: boom/)
    assert.doesNotMatch(e.message, /ok 1 - fine/)
    return true
  })
  assert.equal(head(laptop), before)
  assert.equal(subject(laptop), 'v1')
})

test('refuses: Windows start script changes, local edits, local commits', { timeout: 120_000 }, async () => {
  const { work, laptop } = setup()
  fs.writeFileSync(path.join(work, 'windows', 'start-doorbell.bat'), 'rem v2\n')
  commit(work, 'Change the start script')
  let u = await updaterOf(laptop)
  let s = await u.check()
  assert.equal(s.canUpdate, false)
  assert.match(s.reason, /start script/)

  const b = setup()
  fs.writeFileSync(path.join(b.work, 'feature.txt'), 'new')
  commit(b.work, 'Feature')
  fs.writeFileSync(path.join(b.laptop, 'package.json'), '{"edited":true}')
  u = await updaterOf(b.laptop)
  s = await u.check()
  assert.equal(s.canUpdate, false)
  assert.match(s.reason, /edited on this laptop/)

  sh(b.laptop, 'git', 'checkout', '-q', '--', 'package.json')
  fs.writeFileSync(path.join(b.laptop, 'local.txt'), 'x')
  sh(b.laptop, 'git', 'add', '-A')
  sh(b.laptop, 'git', 'commit', '-q', '-m', 'local')
  s = await u.check()
  assert.equal(s.canUpdate, false)
  assert.match(s.reason, /aren't on GitHub/)
})

test('guard rolls back an update that keeps failing to start', { timeout: 120_000 }, async () => {
  const { work, laptop } = setup()
  fs.writeFileSync(path.join(work, 'feature.txt'), 'new')
  commit(work, 'Update that crashes at start')
  const u = await updaterOf(laptop)
  const before = head(laptop)
  await u.apply(quiet)
  assert.notEqual(head(laptop), before)
  for (let i = 0; i < 3; i++) assert.equal(await u.guard(quiet), 'waiting') // up to 3 tries
  assert.equal(await u.guard(quiet), 'rolled back')
  assert.equal(head(laptop), before)
  assert.equal(u.lastRollback().to, before)
  assert.equal(await u.guard(quiet), 'none')
})

test('guard also rolls back an update that never became healthy within 10 minutes', { timeout: 120_000 }, async () => {
  const { work, laptop } = setup()
  fs.writeFileSync(path.join(work, 'feature.txt'), 'new')
  commit(work, 'Update')
  const u = await updaterOf(laptop)
  const before = head(laptop)
  await u.apply(quiet)
  assert.equal(await u.guard(quiet, Date.now() + 11 * 60_000), 'rolled back')
  assert.equal(head(laptop), before)
})
