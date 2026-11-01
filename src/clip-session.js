// Decides how long one recording runs. A clip starts with the length for its event
// (rings longer than motion). New activity while recording pushes the end out, so one
// continuous clip covers the whole visit, up to maxSeconds in total.
export class ClipSession {
  constructor(event, { dingSeconds, motionSeconds, maxSeconds }) {
    this.lengths = { ding: dingSeconds, motion: motionSeconds }
    this.maxSeconds = Math.max(maxSeconds, dingSeconds, motionSeconds)
    this.event = event
    this.wanted = this.lengthFor(event) // seconds, measured from the moment video starts
    this.startedAt = null
  }

  lengthFor(event) {
    return this.lengths[event] ?? this.lengths.motion
  }

  /** Video is flowing; deadlines count from here. */
  start(now = Date.now()) {
    this.startedAt = now
  }

  /** Another ring/motion arrived while this clip is recording (or still connecting). */
  extend(event, now = Date.now()) {
    if (event === 'ding') this.event = 'ding' // a clip with a ring in it is a ring clip
    const elapsed = this.startedAt === null ? 0 : (now - this.startedAt) / 1000
    this.wanted = Math.min(this.maxSeconds, Math.max(this.wanted, elapsed + this.lengthFor(event)))
  }

  /** When to stop, as a timestamp. Only valid after start(). */
  get deadline() {
    return this.startedAt + this.wanted * 1000
  }
}
