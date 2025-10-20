class MockWaveSurfer {
  constructor() {
    this._events = {}
    this._playing = false
    this._time = 0
    this._duration = 60
  }
  on(name, fn) {
    this._events[name] = fn
  }
  emit(name, ...args) {
    if (this._events[name]) this._events[name](...args)
  }
  async load() {
    // Emit ready immediately to keep tests simple with fake timers
    this.emit('ready')
    return Promise.resolve()
  }
  getCurrentTime() { return this._time }
  getDuration() { return this._duration }
  setTime(t) { this._time = t }
  setPlaybackRate() {}
  isPlaying() { return this._playing }
  play() { this._playing = true; this.emit('play') }
  pause() { this._playing = false; this.emit('pause') }
  destroy() {}
}

module.exports = {
  __esModule: true,
  default: {
    create: () => new MockWaveSurfer(),
  },
}
