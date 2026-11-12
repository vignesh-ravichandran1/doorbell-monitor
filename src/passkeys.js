// Face ID / Touch ID / Windows Hello unlock for the clips page, using passkeys (WebAuthn).
// Works only on a secure address: https (e.g. through `tailscale serve`) or http://localhost.
// Passkeys are tied to the address (rpID) they were made on; the PIN keeps working everywhere.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { APP_DIR } from './config.js'

const CHALLENGE_MS = 2 * 60_000

/** A page origin is fine for passkeys when it's https (or localhost) on the expected host. */
export function originAllowed(origin, rpID) {
  try {
    const u = new URL(origin)
    return u.hostname === rpID && (u.protocol === 'https:' || u.hostname === 'localhost')
  } catch {
    return false
  }
}

const challengeOf = (response) => {
  try {
    const client = JSON.parse(Buffer.from(isoBase64URL.toBuffer(response.response.clientDataJSON)).toString('utf8'))
    return { challenge: client.challenge, origin: client.origin }
  } catch {
    return {}
  }
}

export class Passkeys {
  constructor(file = path.join(APP_DIR, 'data', 'passkeys.json')) {
    this.file = file
    this.challenges = new Map() // challenge -> { type, rpID, expires }
  }

  #read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return { userID: isoBase64URL.fromBuffer(crypto.randomBytes(16)), passkeys: [] }
    }
  }

  #write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.part`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }

  #remember(challenge, type, rpID) {
    const now = Date.now()
    for (const [c, v] of this.challenges) if (v.expires < now) this.challenges.delete(c)
    this.challenges.set(challenge, { type, rpID, expires: now + CHALLENGE_MS })
  }

  // One use only, and only for the flow and address it was issued for.
  #take(response, type) {
    const { challenge, origin } = challengeOf(response)
    const entry = challenge && this.challenges.get(challenge)
    if (!entry) return null
    this.challenges.delete(challenge)
    if (entry.type !== type || entry.expires < Date.now() || !originAllowed(origin, entry.rpID)) return null
    return { challenge, origin, rpID: entry.rpID }
  }

  /** Safe to show on the page: no keys. */
  list(rpID) {
    return this.#read().passkeys
      .filter((p) => !rpID || p.rpID === rpID)
      .map(({ id, name, rpID: rp, createdAt, lastUsedAt }) => ({ id, name, rpID: rp, createdAt, lastUsedAt }))
  }

  async registrationOptions(rpID) {
    const data = this.#read()
    if (!fs.existsSync(this.file)) this.#write(data) // keep the same user id from now on
    const options = await generateRegistrationOptions({
      rpName: 'Doorbell',
      rpID,
      userName: 'doorbell',
      userDisplayName: 'Doorbell owner',
      userID: isoBase64URL.toBuffer(data.userID),
      attestationType: 'none',
      excludeCredentials: data.passkeys.filter((p) => p.rpID === rpID).map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    })
    this.#remember(options.challenge, 'register', rpID)
    return options
  }

  async register(response, name) {
    const issued = this.#take(response, 'register')
    if (!issued) throw new Error('This request expired. Try again.')
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response,
      expectedChallenge: issued.challenge,
      expectedOrigin: issued.origin,
      expectedRPID: issued.rpID,
      requireUserVerification: true,
    })
    if (!verified) throw new Error('Face ID setup could not be verified.')
    const { credential } = registrationInfo
    const data = this.#read()
    data.passkeys = data.passkeys.filter((p) => p.id !== credential.id)
    data.passkeys.push({
      id: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || [],
      rpID: issued.rpID,
      name: String(name || 'Device').slice(0, 60),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    })
    this.#write(data)
    return { id: credential.id }
  }

  /** null when no passkey exists for this address. */
  async authenticationOptions(rpID) {
    const mine = this.#read().passkeys.filter((p) => p.rpID === rpID)
    if (!mine.length) return null
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: mine.map((p) => ({ id: p.id, transports: p.transports })),
      userVerification: 'required',
    })
    this.#remember(options.challenge, 'login', rpID)
    return options
  }

  /** Returns the passkey's name when the Face ID check is valid, else throws. */
  async authenticate(response) {
    const issued = this.#take(response, 'login')
    if (!issued) throw new Error('This request expired. Try again.')
    const data = this.#read()
    const stored = data.passkeys.find((p) => p.id === response.id && p.rpID === issued.rpID)
    if (!stored) throw new Error('This Face ID is not set up here. Use the PIN.')
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge: issued.challenge,
      expectedOrigin: issued.origin,
      expectedRPID: issued.rpID,
      credential: {
        id: stored.id,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports,
      },
      requireUserVerification: true,
    })
    if (!verified) throw new Error('Face ID could not be verified.')
    stored.counter = authenticationInfo.newCounter
    stored.lastUsedAt = new Date().toISOString()
    this.#write(data)
    return stored.name
  }

  remove(id) {
    const data = this.#read()
    const before = data.passkeys.length
    data.passkeys = data.passkeys.filter((p) => p.id !== id)
    this.#write(data)
    return data.passkeys.length < before
  }
}
