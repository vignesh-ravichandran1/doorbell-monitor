// Interactive setup: Ring login, settings, optional auto-start, then the doctor checks.
//   npm run setup    everything
//   npm run login    only the Ring login
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { APP_DIR, config, envFile, loadToken, saveToken, updateEnvText } from './config.js'

const loginOnly = process.argv.includes('--login-only')

// One readline for the whole session. While `secretPrompt` is set, typed characters are
// hidden but the prompt itself is still drawn (readline redraws it when the line changes).
let secretPrompt = null
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
rl._writeToOutput = (s) => {
  if (secretPrompt === null) rl.output.write(s)
  else if (s.includes('\n')) rl.output.write('\n')
  else if (s.startsWith(secretPrompt)) rl.output.write(secretPrompt)
}
const ask = (q, fallback = '') => new Promise((resolve) =>
  rl.question(fallback !== '' ? `${q} [${fallback}]: ` : `${q}: `, (a) => resolve(a.trim() || String(fallback))))
const askSecret = async (q) => {
  const prompt = `${q}: `
  const answer = new Promise((resolve) => rl.question(prompt, resolve)) // draws the prompt now
  secretPrompt = prompt
  try {
    return await answer
  } finally {
    secretPrompt = null
  }
}
const yes = async (q, def = false) => /^y/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'))

async function ringLogin() {
  console.log('\n== Ring login')
  console.log('Your email and password go only to Ring. They are not saved; only a login token is,')
  console.log(`in ${path.basename(config.tokenFile)} on this computer (never uploaded anywhere).\n`)
  const { RingRestClient } = await import('ring-client-api/rest-client')
  for (;;) {
    const email = await ask('Ring email')
    const password = await askSecret('Ring password (hidden)')
    console.log('Contacting Ring...')
    const client = new RingRestClient({ email, password })
    try {
      let auth
      try {
        auth = await client.getCurrentAuth()
      } catch (e) {
        if (!client.promptFor2fa) throw e
        console.log(client.promptFor2fa)
        for (;;) {
          const code = await ask('Verification code')
          try {
            auth = await client.getAuth(code)
            break
          } catch {
            console.log('That code did not work, try again.')
          }
        }
      }
      saveToken(auth.refresh_token)
      console.log('Logged in to Ring.')
      return
    } catch (e) {
      console.log(`Login failed: ${e.message || e}. Check the email/password and try again.\n`)
    }
  }
}

async function settings() {
  console.log('\n== Settings (press Enter to keep the value in [brackets])\n')
  const current = fs.readFileSync(envFile, 'utf8')
  const values = {}

  for (;;) {
    const p = await ask('Folder for clips (e.g. an external disk)', process.env.RECORDINGS_PATH || 'recordings')
    const dir = path.resolve(APP_DIR, p)
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.accessSync(dir, fs.constants.W_OK)
      values.RECORDINGS_PATH = p.replace(/\\/g, '/')
      break
    } catch {
      console.log(`Can't write to ${dir}. Is the disk plugged in? Try another folder.`)
    }
  }
  values.KEEP_DAYS = await ask('Delete clips older than how many days', config.keepDays)
  values.MAX_STORAGE_GB = await ask('Maximum space for all clips, in GB (0 = no limit)', config.maxStorageGb)
  const battery = await yes('Is your doorbell battery-powered? (then only rings are recorded, to save battery)',
    !config.recordOn.has('motion'))
  values.RECORD_ON = battery ? 'ding' : 'ding,motion'

  fs.writeFileSync(envFile, updateEnvText(current, values))
  Object.assign(process.env, values) // so the checks below see the new values
  console.log('Saved to .env')
}

function autostartMac() {
  const label = 'com.doorbell-monitor'
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
  const logs = path.join(APP_DIR, 'logs')
  fs.mkdirSync(path.dirname(plist), { recursive: true })
  fs.mkdirSync(logs, { recursive: true })
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>${process.execPath}</string><string>${path.join(APP_DIR, 'src', 'main.js')}</string>
  </array>
  <key>WorkingDirectory</key><string>${APP_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(logs, 'doorbell.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(logs, 'doorbell.log')}</string>
</dict></plist>
`)
  try { execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' }) } catch {}
  execFileSync('launchctl', ['load', plist])
  console.log(`Started in the background and at every login. Log: logs/doorbell.log`)
  console.log(`To stop auto-start: launchctl unload ${plist} && rm ${plist}`)
}

function autostartWindows() {
  const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'inherit' })
  for (const args of [
    ['/change', 'standby-timeout-ac', '0'],
    ['/change', 'hibernate-timeout-ac', '0'],
    ['/change', 'monitor-timeout-ac', '1'],
    ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', '0'],
    ['/setactive', 'SCHEME_CURRENT'],
  ]) execFileSync('powercfg', args, { stdio: 'ignore' })
  const bat = path.join(APP_DIR, 'windows', 'start-doorbell.bat')
  ps(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\\Doorbell recorder.lnk'); $s.TargetPath='${bat}'; $s.WorkingDirectory='${APP_DIR}'; $s.WindowStyle=7; $s.Save()`)
  console.log('On mains power the laptop will no longer sleep, keeps running with the lid closed,')
  console.log('and the recorder starts (minimised) every time you sign in.')
  console.log('Tip: to survive power cuts, run "netplwiz" and turn on automatic sign-in.')
}

function autostartLinux() {
  const unit = `[Unit]
Description=Ring doorbell recorder
After=network-online.target
Wants=network-online.target

[Service]
User=${os.userInfo().username}
WorkingDirectory=${APP_DIR}
ExecStart=${process.execPath} ${path.join(APP_DIR, 'src', 'main.js')}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`
  const file = path.join(APP_DIR, 'linux', 'doorbell.service')
  fs.writeFileSync(file, unit)
  console.log('Run these two commands to start it now and at every boot:')
  console.log(`  sudo cp ${file} /etc/systemd/system/`)
  console.log('  sudo systemctl enable --now doorbell')
}

async function autostart() {
  console.log('\n== Always-on')
  const kind = { darwin: 'Mac', win32: 'Windows laptop', linux: 'Linux machine' }[process.platform]
  if (!(await yes(`Is this ${kind} the one that will record 24/7 (start automatically, never sleep)?`, false))) {
    console.log('OK. Start it yourself when you want with: npm start')
    return false
  }
  if (process.platform === 'darwin') autostartMac()
  else if (process.platform === 'win32') autostartWindows()
  else autostartLinux()
  return true
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return 'localhost'
}

async function main() {
  if (!fs.existsSync(envFile)) fs.copyFileSync(path.join(APP_DIR, '.env.example'), envFile)

  if (!loadToken() || (await yes('Already logged in to Ring on this computer. Log in again?', false))) {
    await ringLogin()
  }
  if (loginOnly) return rl.close()

  await settings()

  // Run the checks as a fresh process so they read the new .env, and before auto-start
  // so only one program uses the Ring login at a time.
  let ok = true
  try {
    execFileSync(process.execPath, [path.join(APP_DIR, 'src', 'doctor.js')], { stdio: 'inherit' })
  } catch {
    ok = false
  }
  const running = ok && (await autostart())
  rl.close()
  const port = process.env.WEB_PORT || 8080
  console.log(ok ? 'Setup complete.' : 'Setup saved, but fix the problems above first.')
  if (!running) console.log('Start recording with:   npm start')
  console.log(`Watch clips on this computer: http://localhost:${port}`)
  console.log(`From your phone (same Wi-Fi):  http://${lanAddress()}:${port}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
