// Sound, synthesised with Web Audio so there are no files to load: Geiger
// clicks that speed up with power, a pump hum, the turbine's whine and a
// klaxon on a trip. Browsers only allow sound after a tap or click, so
// start() is called from the first one.
(function (root) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function ReactorAudio() {
    this.ctx = null;
    this.on = true;
    this.nextClick = 0;
  }

  ReactorAudio.prototype.start = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.on ? 0.55 : 0;
    this.master.connect(ctx.destination);

    // A short burst of decaying noise for each click.
    const len = Math.floor(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12));
    this.clickBuf = buf;
    this.clickBus = ctx.createBiquadFilter();
    this.clickBus.type = 'highpass';
    this.clickBus.frequency.value = 1800;
    this.clickBus.connect(this.master);

    // Pump hum and turbine whine run all the time; their gains follow the plant.
    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.hum.frequency.value = 100;
    const humLow = ctx.createBiquadFilter();
    humLow.type = 'lowpass';
    humLow.frequency.value = 320;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(humLow);
    humLow.connect(this.humGain);
    this.humGain.connect(this.master);
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whine.frequency.value = 200;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain);
    this.whineGain.connect(this.master);
    this.hum.start();
    this.whine.start();
    this.nextClick = ctx.currentTime;
  };

  ReactorAudio.prototype.setOn = function (on) {
    this.on = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  };

  ReactorAudio.prototype.suspend = function () { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); };
  ReactorAudio.prototype.resume = function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };

  // Called every frame with the plant state; `running` is false when paused.
  ReactorAudio.prototype.update = function (s, running) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const live = running && this.on;
    this.humGain.gain.setTargetAtTime(live ? 0.02 * s.pumpSpeed : 0, now, 0.25);
    this.hum.frequency.setTargetAtTime(55 + 45 * s.pumpSpeed, now, 0.4);
    const spin = clamp(s.rpm / 3000, 0, 1);
    this.whineGain.gain.setTargetAtTime(live ? 0.008 * spin : 0, now, 0.3);
    this.whine.frequency.setTargetAtTime(60 + 240 * spin, now, 0.4);
    if (!live) { this.nextClick = now; return; }
    // Clicks arrive at random, faster with each decade of power.
    const decades = Math.log(Math.max(s.nFiss, 1e-12)) / Math.LN10;
    const rate = clamp(1 + 7 * (decades + 6), 0.4, 48);
    if (this.nextClick < now) this.nextClick = now;
    while (this.nextClick < now + 0.12) {
      this.click(this.nextClick);
      this.nextClick += -Math.log(1 - Math.random()) / rate;
    }
  };

  ReactorAudio.prototype.click = function (t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.clickBuf;
    const g = ctx.createGain();
    g.gain.value = 0.25 + Math.random() * 0.15;
    src.connect(g);
    g.connect(this.clickBus);
    src.start(t);
  };

  function tone(ctx, out, type, freq, t, dur, vol) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Two-tone klaxon for a reactor trip.
  ReactorAudio.prototype.klaxon = function () {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.02;
    for (let i = 0; i < 6; i++) tone(ctx, this.master, 'square', i % 2 ? 470 : 640, t + i * 0.26, 0.24, 0.07);
  };

  // A soft chirp for a new alarm.
  ReactorAudio.prototype.chime = function () {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.02;
    tone(ctx, this.master, 'sine', 880, t, 0.09, 0.06);
    tone(ctx, this.master, 'sine', 1175, t + 0.1, 0.11, 0.05);
  };

  root.ReactorAudio = ReactorAudio;
})(typeof window !== 'undefined' ? window : globalThis);
