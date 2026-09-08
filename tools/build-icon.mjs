/* Regenerates every icon the app ships, FROM THE APP.
 *
 * The icon is the mark, and the only way it cannot drift from the mark is to be the same
 * drawing: this loads the running page, parks the solid face on, and lifts the SVG that
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
/* The mark's own two colours are READ off the page rather than repeated here, for the same
   reason the drawing is: a copy of them in this file is a copy that goes stale the next time
   the mark is repainted, and it went stale exactly once already. The limb darkening needs no
   substitution either — it is black at an alpha, which is a literal already.
   The ground is this file's one real decision, and it is the OPPOSITE of the mark's body: a
   sand sphere on cream is mush and an ink one on the app's black is a hole. Picked from the
   body's luminance so it stays right whatever colour the mark is next. */
const DARK_GROUND = '#0c0d0b', LIGHT_GROUND = '#fbfaf6';
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
  // Face on, which is the cube's rest. The gaze and the blink animate, so park those or the
  // icon is whatever frame the idle happened to be on.
  mcState.rx = 0; mcState.ry = 0; mcState.rz = 0;
  mcState.blink = 1; mcState.gx = 0; mcState.gy = 0;
  // The body moves too, or a bounce caught mid-flight would park the drawing squashed.
  mcState.body = null; mcState.sx = 1; mcState.sy = 1; mcState.ty = 0;
  drawMarkCube();
  const svg = document.getElementById('headerMarkCube');
  // The body is the first drawn shape and it IS the whole extent. Which element it is says
  // what shape the mark is: a path for the cube, a circle for anything round.
  const body = svg.querySelector('circle, path');
  const bb = body.getBBox();
  const cs = getComputedStyle(document.documentElement);
  return { inner: svg.innerHTML, x: bb.x, y: bb.y, w: bb.width, h: bb.height,
           round: body.tagName.toLowerCase() === 'circle',
           shell: cs.getPropertyValue('--mark-shell').trim(),
           ink: cs.getPropertyValue('--mark-ink').trim(),
           lit: cs.getPropertyValue('--mark-lit').trim(),
           rest: `${mcState.rx}/${mcState.ry}/${mcState.rz}` };
});
await page.close();

// sRGB relative luminance of the body, which is what decides which ground it needs.
const lum = (hex)=>{ const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if(!m) throw new Error(`--mark-shell is not a plain hex: ${hex}`);
  const [r,g,b] = [0,2,4].map(i=> parseInt(m[1].slice(i,i+2),16)/255)
                         .map(v=> v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
  return 0.2126*r + 0.7152*g + 0.0722*b; };
const SHELL = cube.shell, INK = cube.ink;
const GROUND = lum(SHELL) > 0.28 ? DARK_GROUND : LIGHT_GROUND;
console.log(`mark at ${cube.rest}, drawn ${cube.w.toFixed(1)}x${cube.h.toFixed(1)}`
          + `, ${SHELL} on ${GROUND}`);

const S = 512;
/* The extent is what the CROP measures: the furthest the drawing gets from its own centre.
   For the cube that was the bbox's half-diagonal, because the corners were the furthest
   points. A circle inscribed in that same bbox has empty corners, and measuring the diagonal
   anyway would shrink the mark by root-two against the margin it is being fitted to. */
const reach = cube.round ? Math.max(cube.w, cube.h) : Math.hypot(cube.w, cube.h);
const k  = (2 * HALF_DIAGONAL) / reach;
const tx = S / 2 - (cube.x + cube.w / 2) * k;
const ty = S / 2 - (cube.y + cube.h / 2) * k;
/* Every var() the mark emits has to be substituted, not just the two it used to have: an
   unresolved custom property in a standalone SVG is not transparent, it makes the property
   invalid and the fill falls back to BLACK. The lit crescent was the third. */
const art = cube.inner.replaceAll('var(--mark-shell)', SHELL)
                      .replaceAll('var(--mark-ink)', INK)
                      .replaceAll('var(--mark-lit)', cube.lit);
if(/var\(/.test(art)) throw new Error('unsubstituted var() left in the icon art: '
  + art.match(/var\([^)]*\)/g).join(' '));
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
