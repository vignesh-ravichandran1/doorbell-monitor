// `npm test`: runs the test suite and ends with a short list of failing tests (name + error).
// The update screen on the phone shows only the last lines of this output, so the summary
// goes last, on stderr, kept to a few lines.
import { spawn } from 'node:child_process'

// Never this computer's settings: not the .env file, and not values already in the
// environment (an update from the Settings page runs this from the recorder, which loaded .env).
process.env.DOORBELL_IGNORE_ENV_FILE = '1'
const { ENV_KEYS } = await import('../src/config.js')
const env = { ...process.env }
for (const key of ENV_KEYS) delete env[key]

const child = spawn(process.execPath, ['--test', '--test-reporter=tap'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env,
})
let out = ''
child.stdout.on('data', (d) => {
  out += d
  process.stdout.write(d)
})
child.on('close', (code) => {
  const lines = out.split(/\r?\n/) // Windows ends lines with \r\n
  const failed = []
  lines.forEach((line, i) => {
    const m = /^\s*not ok \d+ - (.*)$/.exec(line)
    if (!m || /^\s*not ok \d+ - .*\.js$/.test(line) && lines.slice(i + 1, i + 6).some((l) => /failureType: 'subtestsFailed'/.test(l))) return
    let error = ''
    const after = lines.slice(i + 1, i + 40)
    for (let j = 0; j < after.length; j++) {
      if (/^\s*(ok|not ok) \d+/.test(after[j])) break
      const e = /^\s*error:\s*(.*)$/.exec(after[j])
      if (!e) continue
      // "error: 'text'" on one line, or "error: |-" with the text on the following lines
      error = /^[|>]/.test(e[1])
        ? after.slice(j + 1, j + 4).map((l) => l.trim()).filter(Boolean).join(' ')
        : e[1].replace(/^['"]|['"]$/g, '')
      break
    }
    failed.push(`FAILED: ${m[1].trim()}${error ? ` -- ${error}` : ''}`.slice(0, 300))
  })
  if (failed.length) process.stderr.write(`\n${failed.slice(0, 6).join('\n')}\n`)
  process.exit(code ?? 1)
})
