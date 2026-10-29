// Makes reactor/share.png, the 1200 × 630 picture link previews show: the
// plant at full power scaled up 2.5×, with the title over the ground. Needs
// Playwright (`npm i playwright`) for the fonts and the screenshot.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const Sim = require('../js/sim.js');
const Scenarios = require('../js/scenarios.js');
const Render = require('../js/render.js');

const s = Scenarios.start('full'), r = new Render.Renderer(), f = new Uint32Array(Render.W * Render.H);
for (let i = 0; i < 20 * 60 + 32; i++) { Sim.step(s, 1 / 60); if (i % 2 === 0) r.draw(f, s, 1 / 30, {}); }
const pixels = Buffer.from(f.buffer).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&family=Press+Start+2P&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; background: #0b1220; }
  #c { position: relative; width: 1200px; height: 630px; overflow: hidden; }
  canvas { position: absolute; left: 0; top: 0; }
  .shade { position: absolute; left: 470px; right: 0; bottom: 0; height: 190px;
    background: linear-gradient(180deg, rgba(10,8,6,0) 0%, rgba(10,8,6,0.55) 45%, rgba(10,8,6,0.8) 100%); }
  .t { position: absolute; left: 538px; bottom: 34px; color: #eef2f6; }
  h1 { font: 30px/1.2 'Press Start 2P', monospace; margin: 0 0 16px; text-shadow: 3px 3px 0 #000; }
  p { font: 600 24px/1.25 Inter, sans-serif; margin: 0 0 10px; color: #dbe3ec; text-shadow: 0 2px 4px #000; }
  .u { font: 500 18px/1.2 Inter, sans-serif; color: #7fc3ff; margin: 0; }
</style></head><body><div id="c"><canvas width="1200" height="630"></canvas><div class="shade"></div>
<div class="t"><h1>Pixel Nuclear Reactor</h1><p>A small modular reactor you can run in your browser</p><p class="u">zafirmaricar.github.io/reactor</p></div></div>
<script>
  const bytes = Uint8ClampedArray.from(atob('${pixels}'), (ch) => ch.charCodeAt(0));
  const src = document.createElement('canvas');
  src.width = ${Render.W}; src.height = ${Render.H};
  src.getContext('2d').putImageData(new ImageData(bytes, ${Render.W}, ${Render.H}), 0, 0);
  const g = document.querySelector('canvas').getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, -20, 1200, 675);
</script></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#c').screenshot({ path: path.join(__dirname, '..', 'share.png') });
  await browser.close();
})();
