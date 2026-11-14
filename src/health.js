// What the clips page shows about the recorder itself, so a silent failure (no Ring events
// arriving, recordings failing) is visible the moment the page is opened instead of days later.
// main.js reports into it; server.js serves report() at /api/health.

const START_GRACE_MS = 3 * 60_000 // Ring login + push connection can take a while after a restart
const PUSH_DOWN_MS = 3 * 60_000 // short reconnects are normal; longer means events are being missed

const state = {
  startedAt: Date.now(),
  cameras: [],
  pushState: null, // () => { connectedAt, downSince, drops, pushes } from push-debug.js
  lastEvent: null, // { event, camera, at }
  lastClip: null, // { name, seconds, at }
  lastFailure: null, // a recording that failed: { message, at }
  lastError: null, // anything else that went wrong: { what, message, at }
}

export const health = {
  watching(cameras, pushState) {
    state.cameras = cameras
    state.pushState = pushState ?? null
  },
  event(event, camera) {
    state.lastEvent = { event, camera, at: Date.now() }
  },
  clip(name, seconds) {
    state.lastClip = { name, seconds, at: Date.now() }
  },
  recordingFailed(message) {
    state.lastFailure = { message, at: Date.now() }
  },
  error(what, message) {
    state.lastError = { what, message, at: Date.now() }
  },
  /** For tests. */
  reset(now = Date.now()) {
    Object.assign(state, { startedAt: now, cameras: [], pushState: null, lastEvent: null, lastClip: null, lastFailure: null, lastError: null })
  },
}

/** { level: 'ok' | 'starting' | 'problem', headline, ...details } for the page. */
export function report(now = Date.now()) {
  const push = state.pushState?.() ?? null
  const starting = now - state.startedAt < START_GRACE_MS
  const failedSinceLastClip = state.lastFailure && (!state.lastClip || state.lastFailure.at > state.lastClip.at)
  const pushDown = push && !push.connectedAt && now - push.downSince > PUSH_DOWN_MS

  let level = 'ok'
  let headline = state.cameras.length ? `Recording: watching ${state.cameras.join(', ')}` : 'Recording'
  if (!state.cameras.length) {
    level = starting ? 'starting' : 'problem'
    headline = starting ? 'Starting: logging in to Ring…' : 'Not connected to Ring (login failed or no doorbell found). Run npm run doctor on the laptop.'
  } else if (pushDown) {
    level = 'problem'
    headline = `Not receiving Ring events: the event connection has been down for ${Math.round((now - push.downSince) / 60000)} min. Rings and motion are being missed.`
  } else if (push && !push.connectedAt) {
    level = 'starting'
    headline = 'Connecting to Ring events…'
  } else if (failedSinceLastClip) {
    level = 'problem'
    headline = `The last recording failed: ${state.lastFailure.message}`
  }

  return {
    level,
    headline,
    startedAt: state.startedAt,
    cameras: state.cameras,
    events: push ? { connected: Boolean(push.connectedAt), since: push.connectedAt || push.downSince, drops: push.drops } : null,
    lastEvent: state.lastEvent,
    lastClip: state.lastClip,
    lastFailure: state.lastFailure,
    lastError: state.lastError,
  }
}
