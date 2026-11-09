// Makes Ring's push (event) connection visible. ring-client-api creates the push receiver
// (@eneris/push-receiver) internally with debug off and never says whether it connected,
// so a dead event connection looks exactly like a quiet doorbell. Call before new RingApi().
//  - always: logs when the push connection is ready, drops, or gets new credentials
//  - verbose (--debug): also the receiver's own debug lines (heartbeats etc.) and every raw push
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Receiver debug lines that print push keys/credentials; never show those.
const SECRET_DEBUG = new Set(['constructor', 'got credentials'])
// Byte-level parser chatter, several lines per packet; useless in a log.
const NOISE = /^(Got data|waitForData|Waiting for|Processing MCS|Proto size|RECEIVED PROTO|VERSION IS)/

/** Returns status() for a one-line summary of the push connection. */
export function watchPush(log, { verbose = false } = {}) {
  let logger, Emitter
  try {
    logger = require('@eneris/push-receiver/dist/utils/logger.js').default
    Emitter = require('@eneris/push-receiver/dist/emitter.js').default
  } catch (e) {
    log('push status logging unavailable:', e.message)
    return () => 'push status unknown'
  }

  if (verbose) {
    const setDebug = logger.setDebug
    logger.setDebug = () => setDebug(true) // ring-client-api passes debug: false; keep it on
    setDebug(true)
    logger.debug = (first, ...rest) => {
      if (SECRET_DEBUG.has(first) || NOISE.test(String(first))) return
      log('[push debug]', first, ...rest.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)))
    }
  }

  let connectedAt = 0
  let heartbeats = 0
  let pushes = 0
  let drops = 0
  const emit = Emitter.prototype.emit
  Emitter.prototype.emit = function (name, ...args) {
    switch (name) {
      case 'ON_READY':
        connectedAt = Date.now()
        heartbeats = 0
        log('[push] connected to Google push service (mtalk.google.com:5228), ready for Ring events')
        break
      case 'ON_DISCONNECT': {
        const up = connectedAt ? `${Math.round((Date.now() - connectedAt) / 60000)} min` : 'never got ready'
        log(`[push] disconnected (was up ${up}, ${heartbeats} heartbeats); reconnecting`)
        connectedAt = 0
        drops++
        break
      }
      case 'ON_CREDENTIALS_CHANGE':
        log('[push] registered new push credentials with Google; Ring will be told the new token')
        break
      case 'ON_HEARTBEAT':
        heartbeats++
        if (verbose) log('[push debug] heartbeat')
        break
      case 'ON_MESSAGE_RECEIVED':
        pushes++
        if (verbose) {
          const data = args[0]?.message?.data ?? {}
          log('[push debug] raw push received, fields:', Object.keys(data).join(', ') || '(none)')
        }
        break
    }
    return emit.call(this, name, ...args)
  }

  return () => connectedAt
    ? `push connected ${Math.round((Date.now() - connectedAt) / 60000)} min, ${heartbeats} heartbeats, ${pushes} pushes, ${drops} drops so far`
    : `push NOT connected (${drops} drops so far)`
}
