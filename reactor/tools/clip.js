// Records the clip on the Projects card straight from the simulation: the
// plant at full power, then a SCRAM, crossfaded back into the start so it
// loops. Writes raw 480 × 270 RGBA frames at 30 fps to stdout for ffmpeg
// (commands in the README). `--poster` writes only the first frame.
'use strict';
const Sim = require('../js/sim.js');
const Scenarios = require('../js/scenarios.js');
const Render = require('../js/render.js');

const W = Render.W, H = Render.H, FPS = 30, SUB = 60 / FPS;
const CALM = 3.5, AFTER = 6, FADE = 0.5; // seconds
const poster = process.argv.includes('--poster');
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const s = Scenarios.start('full'), r = new Render.Renderer(), f = new Uint32Array(W * H);
const view = { neutrons: false, alarm: false, shake: false };
// Warm up so the plume, steam and bubbles are established.
for (let i = 0; i < 20 * 60; i++) { Sim.step(s, 1 / 60); if (i % SUB === 0) r.draw(f, s, SUB / 60, view); }

// Record FADE seconds more than the loop; the clip starts FADE in, and its
// last FADE seconds blend into those first frames.
const N = Math.round((CALM + AFTER) * FPS), K = Math.round(FADE * FPS);
const rec = [];
let shakeUntil = -1;
for (let i = 0; i < (poster ? K + 1 : N + K); i++) {
  const t = i / FPS;
  if (!s.tripped && t >= CALM + FADE) { Sim.scram(s); shakeUntil = t + 0.45; }
  for (let k = 0; k < SUB; k++) Sim.step(s, 1 / 60);
  view.alarm = s.tripped;
  view.shake = t < shakeUntil;
  r.draw(f, s, SUB / 60, view);
  rec.push(Buffer.from(f.buffer.slice(0)));
}
if (poster) process.stdout.write(rec[K]);
else for (let i = K; i < N + K; i++) {
  let out = rec[i];
  if (i >= N) {
    const a = (i - N + 1) / (K + 1), b = rec[i - N];
    out = Buffer.alloc(out.length);
    for (let j = 0; j < out.length; j++) out[j] = Math.round(rec[i][j] * (1 - a) + b[j] * a);
  }
  process.stdout.write(out);
}
