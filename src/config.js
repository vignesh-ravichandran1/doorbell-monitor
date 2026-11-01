// Settings come from the .env file next to package.json (all optional except the Ring token).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const envFile = path.join(APP_DIR, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const env = (name, fallback) => process.env[name] ?? fallback
const list = (name, fallback) =>
  new Set(env(name, fallback).split(',').map((s) => s.trim()).filter(Boolean))

export const config = {
  ringRefreshToken: env('RING_REFRESH_TOKEN', ''),
  tokenFile: path.join(APP_DIR, '.ring-token'),
  recordingsDir: path.resolve(APP_DIR, env('RECORDINGS_PATH', 'recordings')),
  recordSeconds: Number(env('RECORD_SECONDS', '30')),
  recordOn: list('RECORD_ON', 'ding,motion'),
  notifyOn: list('NOTIFY_ON', ''),
  motionCooldownSeconds: Number(env('MOTION_COOLDOWN_SECONDS', '120')),
  keepDays: Number(env('KEEP_DAYS', '14')),
  maxStorageGb: Number(env('MAX_STORAGE_GB', '20')),
  minFreeGb: Number(env('MIN_FREE_GB', '5')),
  webPort: Number(env('WEB_PORT', '8080')),
  webBaseUrl: env('WEB_BASE_URL', '').replace(/\/$/, ''),
  ntfyUrl: env('NTFY_URL', 'https://ntfy.sh').replace(/\/$/, ''),
  ntfyTopic: env('NTFY_TOPIC', ''),
  ntfyToken: env('NTFY_TOKEN', ''),
}
