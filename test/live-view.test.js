// Live view's WebRTC, end to end without a doorbell: ring-client-api's own peer connection
// (the code used for every recording) negotiates with a werift peer playing the doorbell,
// which sends video packets. Guards upgrades of werift, the WebRTC library underneath.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ringLib = path.dirname(require.resolve('ring-client-api'))
const { WeriftPeerConnection } = await import(pathToFileURL(path.join(ringLib, 'streaming', 'peer-connection.js')).href)
const { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader } = await import('werift')

const until = (fn, ms) => new Promise((resolve) => {
  const end = Date.now() + ms
  const tick = () => (fn() || Date.now() > end ? resolve() : setTimeout(tick, 50))
  tick()
})

test('ring-client-api live view receives video over werift', { timeout: 90_000 }, async () => {
  const ring = new WeriftPeerConnection()
  const bell = new RTCPeerConnection({ codecs: ring.pc.config.codecs })
  try {
    let connected = false
    let packets = 0
    ring.onConnectionState.subscribe((s) => { if (s === 'connected') connected = true })
    ring.onVideoRtp.subscribe(() => packets++)
    ring.onIceCandidate.subscribe((c) => bell.addIceCandidate(c).catch(() => {}))
    bell.onIceCandidate.subscribe((c) => c && ring.addIceCandidate(c).catch(() => {}))

    await bell.setRemoteDescription(await ring.createOffer())
    const video = new MediaStreamTrack({ kind: 'video' })
    const transceiver = bell.getTransceivers().find((t) => t.kind === 'video')
    transceiver.setDirection('sendonly')
    await transceiver.sender.replaceTrack(video)
    await bell.setLocalDescription(await bell.createAnswer())
    await ring.acceptAnswer(bell.localDescription)
    await until(() => connected, 30_000)
    assert.ok(connected, 'WebRTC connection established')

    const payloadType = Number(/m=video \d+ \S+ (\d+)/.exec(bell.localDescription.sdp)[1])
    for (let seq = 0; seq < 40; seq++) {
      video.writeRtp(new RtpPacket(new RtpHeader({ payloadType, sequenceNumber: seq, timestamp: seq * 3000, marker: true }), Buffer.from([0x65, 1, 2, 3])))
      await new Promise((r) => setTimeout(r, 20))
    }
    await until(() => packets >= 30, 5_000)
    assert.ok(packets >= 30, `video packets received: ${packets} of 40`)
  } finally {
    ring.close()
    await bell.close()
  }
})
