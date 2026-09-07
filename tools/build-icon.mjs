/* Regenerates every icon the app ships, FROM THE APP.
 *
 * The icon is the mark, and the only way it cannot drift from the mark is to be the same
 * drawing: this loads the running page, parks the solid at MC_REST, and lifts the SVG that
 * drawMarkCube produced. Change the mark's colour, its resting angle or its geometry and this
 * picks all of it up; redraw the icon by hand and it is wrong the next time any of that moves.
 *
 *   npm i playwright                   (not vendored; same as groundcheck)
 *   python3 -m http.server 8899        (from the repo root)
 *   node tools/build-icon.mjs
 *
 * Writes icon-512.png (what the manifest installs) and rewrites the two inline <link> icons in
 * index.html at the sizes those links are actually for — 180 for apple-touch, 32 for the tab.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.ICON_URL || 'http://localhost:8899/index.html';
const EXEC = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/* Cream, not the app's own dark ground. On the dark ground this is the mark exactly as it
   appears in the header — and as a thing on a home screen it is a dark cube on a dark square,
   which is not an icon, it is a hole. The shading stays the app's: an ink body has nowhere
   down to go, so its lit faces come UP toward the ink. Flipped to darken, all three faces
   crush together and the cube goes back to being a blob. */
const GROUND = '#fbfaf6', SHELL = '#1c1d17', INK = '#fbfaf6', TONE = '251,250,246';
/* Maskable icons may be cropped to the central 80% circle, so the drawing has to sit inside a
   circle of radius 0.4S. Fitted to a half-diagonal of 181.6 — the margin the two-capsule icon
   this replaces was drawn to — rather than to the full square. */
const HALF_DIAGONAL = 181.6;

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
if (await page.$('#firstRunBuildBtn')) {
  await page.click('#firstRunGoal [data-goal="strength"]');
  const days = await page.$$('#firstRunDays .type-btn');
  for (let i = 0; i < 7; i++) if (days[i]) await days[i].click();
  await page.click('#firstRunLength [data-len="60"]');
  await page.click('#firstRunBuildBtn');
  await page.waitForTimeout(4000);
}
// The wordmark's mount is the one that carries the mark's own colours.
await page.evaluate(() => activateTab('training'));
await page.waitForTimeout(1600);
const cube = await page.evaluate(() => {
  if (mcState.raf) { cancelAnimationFrame(mcState.raf); mcState.raf = null; }
  mcState.step = null; mcState.queue = [];
  mcState.rx = MC_REST.rx; mcState.ry = MC_REST.ry; mcState.rz = MC_REST.rz;
  mcState.blink = 1; mcState.gx = 0; mcState.gy = 0;
  drawMarkCube();
  const svg = document.getElementById('headerMarkCube');
  const bb = svg.querySelector('path').getBBox();   // the silhouette IS the extent
  return { inner: svg.innerHTML, x: bb.x, y: bb.y, w: bb.width, h: bb.height,
           rest: `${MC_REST.rx}/${MC_REST.ry}/${MC_REST.rz}` };
});
await page.close();
console.log(`mark at ${cube.rest}, drawn ${cube.w.toFixed(1)}x${cube.h.toFixed(1)}`);

const S = 512;
const k  = (2 * HALF_DIAGONAL) / Math.hypot(cube.w, cube.h);
const tx = S / 2 - (cube.x + cube.w / 2) * k;
const ty = S / 2 - (cube.y + cube.h / 2) * k;
const art = cube.inner.replaceAll('var(--mark-shell)', SHELL)
                      .replaceAll('var(--mark-ink)', INK)
                      .replaceAll('var(--mark-tone-rgb)', TONE);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`
  + `<rect width="${S}" height="${S}" fill="${GROUND}"/>`
  + `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})">${art}</g></svg>`;

async function png(size) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await p.waitForTimeout(250);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}
const big = await png(512);
writeFileSync(join(ROOT, 'icon-512.png'), big);
const b180 = (await png(180)).toString('base64');
const b32  = (await png(32)).toString('base64');
await browser.close();

const file = join(ROOT, 'index.html');
let html = readFileSync(file, 'utf8');
const before = html.length;
const links = [
  [/<link rel="apple-touch-icon" href="data:image\/png;base64,[A-Za-z0-9+/=]+">/,
   `<link rel="apple-touch-icon" href="data:image/png;base64,${b180}">`],
  [/<link rel="icon" type="image\/png"(?: sizes="32x32")? href="data:image\/png;base64,[A-Za-z0-9+/=]+">/,
   `<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${b32}">`],
];
for (const [re, out] of links) {
  if (!re.test(html)) throw new Error(`inline icon link not found: ${re}`);
  html = html.replace(re, out);
}
writeFileSync(file, html);
console.log(`icon-512.png ${big.length}B · inline 180 + 32 · index.html ${before} -> ${html.length}`);
