// Settings editable from the web page: definitions, validation, PIN check and saving to .env.
// Most apply live by updating the shared `config` object; a few need an app restart.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { APP_DIR, envFile, updateEnvText } from './config.js'

const EVENTS = ['ding', 'motion']

// key: .env name; prop: field in `config`; live: false means it needs a restart.
export const FIELDS = [
  { key: 'MAX_STORAGE_GB', prop: 'maxStorageGb', type: 'number', min: 0, max: 100000, live: true },
  { key: 'MIN_FREE_GB', prop: 'minFreeGb', type: 'number', min: 0, max: 10000, live: true },
  { key: 'KEEP_DAYS', prop: 'keepDays', type: 'integer', min: 0, max: 3650, live: true },
  { key: 'RECORD_SECONDS_DING', prop: 'recordSecondsDing', type: 'integer', min: 5, max: 600, live: true },
  { key: 'RECORD_SECONDS_MOTION', prop: 'recordSecondsMotion', type: 'integer', min: 5, max: 600, live: true },
  { key: 'MAX_CLIP_SECONDS', prop: 'maxClipSeconds', type: 'integer', min: 10, max: 1800, live: true },
  { key: 'RECORD_ON', prop: 'recordOn', type: 'events', live: true },
  { key: 'NOTIFY_ON', prop: 'notifyOn', type: 'events', live: true },
  { key: 'MOTION_COOLDOWN_SECONDS', prop: 'motionCooldownSeconds', type: 'integer', min: 0, max: 86400, live: true },
  { key: 'NTFY_TOPIC', prop: 'ntfyTopic', type: 'topic', live: true },
  { key: 'WEB_BASE_URL', prop: 'webBaseUrl', type: 'url', live: true },
  { key: 'RECORDINGS_PATH', prop: 'recordingsDir', type: 'folder', live: false },
  { key: 'WEB_PORT', prop: 'webPort', type: 'integer', min: 1024, max: 65535, live: false },
]

/** Current values in the shape the page edits. */
export function currentSettings(config) {
  const out = {}
  for (const f of FIELDS) {
    const v = config[f.prop]
    if (!f.live) out[f.key] = process.env[f.key] ?? (f.key === 'RECORDINGS_PATH' ? 'recordings' : v) // saved value, even before a restart
    else out[f.key] = f.type === 'events' ? [...v] : v
  }
  return out
}

/** Restart-only settings whose saved value differs from what the app is running with. */
export function pendingRestart(config) {
  return FIELDS.filter((f) => !f.live && process.env[f.key] !== undefined).filter((f) =>
    f.key === 'RECORDINGS_PATH'
      ? path.resolve(APP_DIR, process.env[f.key]) !== config.recordingsDir
      : String(process.env[f.key]) !== String(config[f.prop])).map((f) => f.key)
}

/**
 * Check submitted values. Returns { values, errors }: values are .env strings for the
 * fields that changed and are valid; errors maps field -> message.
 */
export function validateSettings(input, config) {
  const values = {}
  const errors = {}
  const current = currentSettings(config)
  for (const f of FIELDS) {
    if (!(f.key in input)) continue
    const raw = input[f.key]
    let value
    switch (f.type) {
      case 'number':
      case 'integer': {
        const n = Number(raw)
        if (raw === '' || !Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) {
          errors[f.key] = f.type === 'integer' ? 'Enter a whole number.' : 'Enter a number.'
        } else if (n < f.min || n > f.max) {
          errors[f.key] = `Must be between ${f.min} and ${f.max}.`
        } else value = String(n)
        break
      }
      case 'events': {
        const list = Array.isArray(raw) ? raw : []
        if (!list.every((e) => EVENTS.includes(e))) errors[f.key] = 'Unknown event type.'
        else value = EVENTS.filter((e) => list.includes(e)).join(',')
        break
      }
      case 'topic':
        if (!/^[A-Za-z0-9_-]{0,64}$/.test(String(raw))) errors[f.key] = 'Use letters, numbers, - and _ only (max 64).'
        else value = String(raw)
        break
      case 'url':
        if (raw !== '' && !/^https?:\/\/[^\s"'<>]+$/.test(String(raw))) errors[f.key] = 'Use a full address like http://192.168.2.50:8080, or leave empty.'
        else value = String(raw).replace(/\/$/, '')
        break
      case 'folder': {
        const p = String(raw).trim()
        const dir = path.resolve(APP_DIR, p)
        try {
          if (!p) throw new Error()
          fs.mkdirSync(dir, { recursive: true })
          fs.accessSync(dir, fs.constants.W_OK)
          value = p.replace(/\\/g, '/')
        } catch {
          errors[f.key] = `Can't write to ${dir}. Is the disk plugged in?`
        }
        break
      }
    }
    const before = Array.isArray(current[f.key]) ? current[f.key].join(',') : String(current[f.key])
    if (value !== undefined && value !== before) values[f.key] = value
  }
  if (input.MAX_CLIP_SECONDS !== undefined && !errors.MAX_CLIP_SECONDS) {
    const longest = Math.max(Number(input.RECORD_SECONDS_DING ?? config.recordSecondsDing), Number(input.RECORD_SECONDS_MOTION ?? config.recordSecondsMotion))
    if (Number(input.MAX_CLIP_SECONDS) < longest) errors.MAX_CLIP_SECONDS = `Must be at least the longest clip length (${longest}s).`
  }
  if (Object.keys(errors).length) return { values: {}, errors }
  return { values, errors }
}

/** Save to .env and apply live ones to `config`. Returns keys still waiting for a restart. */
export function applySettings(values, config, file = envFile) {
  if (!Object.keys(values).length) return pendingRestart(config)
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  fs.writeFileSync(file, updateEnvText(text, values))
  for (const [key, value] of Object.entries(values)) {
    const f = FIELDS.find((x) => x.key === key)
    process.env[key] = value
    if (!f.live) continue
    config[f.prop] = f.type === 'events' ? new Set(value.split(',').filter(Boolean))
      : f.type === 'number' || f.type === 'integer' ? Number(value) : value
  }
  return pendingRestart(config)
}

// ---- PIN ----

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt:${salt}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`
}

export function checkPin(pin, stored) {
  const [kind, salt, hash] = String(stored || '').split(':')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const got = crypto.scryptSync(String(pin), salt, 32)
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

/** Read fresh from .env so `npm run pin` works without restarting the recorder. */
export function storedPinHash() {
  try {
    return parseEnv(fs.readFileSync(envFile, 'utf8')).SETTINGS_PIN_HASH || ''
  } catch {
    return process.env.SETTINGS_PIN_HASH || ''
  }
}

export const validPin = (pin) => /^\d{4,12}$/.test(String(pin))

/** Logged-in browsers (in memory: a restart logs everyone out) and a lockout after wrong PINs. */
export class Sessions {
  constructor({ ttlMs = 12 * 3600_000, maxFails = 5, lockMs = 5 * 60_000 } = {}) {
    Object.assign(this, { ttlMs, maxFails, lockMs, tokens: new Map(), fails: 0, lockedUntil: 0 })
  }

  login(pin, stored, now = Date.now()) {
    if (now < this.lockedUntil) return { error: `Too many wrong PINs. Try again in ${Math.ceil((this.lockedUntil - now) / 60000)} min.` }
    if (!stored) return { error: 'No PIN set yet. On the recording computer run: npm run pin' }
    if (!checkPin(pin, stored)) {
      if (++this.fails >= this.maxFails) {
        this.fails = 0
        this.lockedUntil = now + this.lockMs
      }
      return { error: 'Wrong PIN.' }
    }
    this.fails = 0
    return { token: this.issue(now) }
  }

  /** A new logged-in browser, after the PIN or a Face ID check passed. */
  issue(now = Date.now()) {
    const token = crypto.randomBytes(24).toString('hex')
    this.tokens.set(token, now + this.ttlMs)
    return token
  }

  valid(token, now = Date.now()) {
    const exp = token && this.tokens.get(token)
    if (!exp) return false
    if (now > exp) {
      this.tokens.delete(token)
      return false
    }
    return true
  }

  logout(token) {
    this.tokens.delete(token)
  }
}
