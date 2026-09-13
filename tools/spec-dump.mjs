/* SPEC DUMP — the engine's own numbers, taken from the running app rather than read off the
   source. Anything computed (SIG_ALPHA is 1 - e^-1/7) comes out evaluated, which is the whole
   reason this reads the page instead of grepping the file.

   Writes three things into spec/:
     constants.json  every scalar / small-object engine parameter, evaluated
     libraries.json  the content libraries — exercises, mobility, protocols
     golden.json     inputs -> outputs for the pure scoring functions
     scenarios.json  the 22 behavioural scenarios and their current verdicts

   A native port is conformant when it reproduces golden.json exactly and passes the same
   scenarios. Regenerate with:  node tools/spec-dump.mjs
*/
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const PORT = process.env.PORT || '8899';
const src = readFileSync('index.html', 'utf8');

/* Every UPPER_SNAKE const the file declares at top level. Read from the source only to get
   the NAMES; every value below is whatever the page evaluates it to. */
const names = [...new Set([...src.matchAll(/^const ([A-Z][A-Z0-9_]{2,})\s*=/gm)].map(m => m[1]))];

/* The content libraries are large and are data rather than parameters, so they go in their
   own file — a port needs them verbatim, but nobody wants them in a diff about a threshold. */
const LIBRARY = /LIBRARY|_TESTS$|PROTOCOLS|TEMPLATES|PROGRESSION_TREES|SCENARIOS|_CUES$/;

/* RUNTIME STATE THAT HAPPENS TO BE DECLARED const. These are not engine parameters and they
   change on every load, which made the first version of this dump non-deterministic: a fresh
   id and a fresh timestamped score sample landed in constants.json each run. Excluded by name
   rather than by "looks like it changed", so a parameter that genuinely drifts still fails the
   check at the bottom instead of being quietly tolerated. */
const RUNTIME = new Set(['SCORE_LOAD_ID', 'SCORE_SAMPLES', 'EYE_ANIM_DEFAULTS',
                         'AREA_TO_MOBILITY_DOMAIN']);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{ width:390, height:844 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/index.html`);
await p.waitForTimeout(3500);

const dump = async page => page.evaluate(ns => {
  const out = {}, missing = [];
  for(const n of ns){
    try {
      const v = eval(n);
      if(typeof v === 'function'){ missing.push(n + ' (function)'); continue; }
      out[n] = JSON.parse(JSON.stringify(v, (k, val) =>
        typeof val === 'function' ? '[fn]' : val === Infinity ? '[Infinity]' : val));
    } catch(e){ missing.push(n + ' (' + e.message.slice(0, 40) + ')'); }
  }
  return { out, missing };
}, names.filter(n => !RUNTIME.has(n)));

/* GOLDEN CASES for the pure scorer. scoresForEntry takes an entry and a trailing summary and
   returns two numbers; it touches no storage and no DOM, so it is the one part of the cascade
   that can be pinned exactly. The cases walk each input to its edges and past them. */
const dumped = await dump(p);

/* THE TOOL CHECKS ITSELF. A spec nobody can regenerate byte-for-byte is a spec that drifts
   from the code it claims to describe, and the only way to know is to do it twice. */
const second = await dump(p);
const drifted = Object.keys(dumped.out).filter(k =>
  JSON.stringify(dumped.out[k]) !== JSON.stringify(second.out[k]));

const golden = await p.evaluate(() => {
  const T = (n, d, w, h) => ({ durationN:n, avgDuration:d, wakeTimeN:n, avgWakeTime:w, hrvN:n, avgHRV:h });
  const cases = [
    ['empty',              {}, null],
    ['duration only',      { durationHrs:8 }, null],
    ['short sleep',        { durationHrs:5 }, null],
    ['over 8h',            { durationHrs:9.5 }, null],
    ['wake 0',             { wakeTimeOura:0 }, null],
    ['wake 30',            { wakeTimeOura:30 }, null],
    ['wake 90 (clamps)',   { wakeTimeOura:90 }, null],
    ['hrv at baseline',    { hrvOura:60, hrvBaseline:60 }, null],
    ['hrv under',          { hrvOura:40, hrvBaseline:60 }, null],
    ['hrv over (clamps)',  { hrvOura:120, hrvBaseline:60 }, null],
    ['garmin wins hrv',    { hrvOura:40, hrvGarmin:70, hrvBaseline:60 }, null],
    ['oura wins wake',     { wakeTimeOura:10, wakeTimeGarmin:60 }, null],
    ['all three',          { durationHrs:7.5, wakeTimeOura:20, hrvOura:55, hrvBaseline:60 }, null],
    ['trailing under min', { durationHrs:7.5, wakeTimeOura:20, hrvOura:55, hrvBaseline:60 }, T(2, 8, 15, 60)],
    ['trailing at min',    { durationHrs:7.5, wakeTimeOura:20, hrvOura:55, hrvBaseline:60 }, T(3, 8, 15, 60)],
    ['trailing rich',      { durationHrs:7.5, wakeTimeOura:20, hrvOura:55, hrvBaseline:60 }, T(30, 7, 25, 50)],
    ['hrv no baseline',    { hrvOura:55 }, null],
    ['zero duration',      { durationHrs:0 }, null],
  ];
  const rows = cases.map(([name, entry, trailing]) => ({
    name, entry, trailing, out: scoresForEntry(entry, trailing)
  }));
  /* Two more pure ones worth pinning: the band split the score log uses, and the ladder word
     the number turns into. Both are decisions a port has to make identically. */
  const bands = [0, 19, 20, 39, 40, 69, 70, 100].map(n => ({ n, band: bandOf(n, 40, 70) }));
  const ladder = [0, 10, 25, 45, 60, 75, 90, 100].map(n => ({ n, word: scoreLadderLabel(n) }));
  return { scoresForEntry: rows, bandOf: bands, scoreLadderLabel: ladder };
});

const scenarios = await p.evaluate(async () => {
  const rows = await runEngineScenarioSuite();
  return rows.map(r => ({ id:r.id, backlogRef:r.backlogRef, description:r.description,
                          pass:r.pass, note:r.note || null }));
});

console.log('page errors:', errs.length ? errs.slice(0,3) : 'none');
await b.close();

mkdirSync('spec', { recursive:true });
const consts = {}, libs = {};
for(const [k, v] of Object.entries(dumped.out)) (LIBRARY.test(k) ? libs : consts)[k] = v;

const stamp = { generatedFrom: (src.match(/const APP_VERSION = '([^']+)'/) || [])[1],
                generatedBy: 'tools/spec-dump.mjs' };
writeFileSync('spec/constants.json', JSON.stringify({ ...stamp, constants:consts }, null, 1));
writeFileSync('spec/libraries.json', JSON.stringify({ ...stamp, libraries:libs }, null, 1));
writeFileSync('spec/golden.json',    JSON.stringify({ ...stamp, ...golden }, null, 1));
writeFileSync('spec/scenarios.json', JSON.stringify({ ...stamp, scenarios }, null, 1));

console.log('constants :', Object.keys(consts).length);
console.log('libraries :', Object.keys(libs).length);
console.log('golden    :', golden.scoresForEntry.length, 'scorer cases');
console.log('scenarios :', scenarios.filter(s=>s.pass).length + '/' + scenarios.length, 'pass');
if(dumped.missing.length) console.log('not dumped:', dumped.missing.length,
  '(' + dumped.missing.slice(0,4).join(', ') + (dumped.missing.length>4 ? ', …' : '') + ')');
if(drifted.length){
  console.error('NOT DETERMINISTIC — these changed between two dumps of the same page:');
  drifted.forEach(k => console.error('   ' + k));
  console.error('Either they are runtime state (add to RUNTIME) or the engine is not stable.');
  process.exit(1);
}
console.log('determinism: two dumps identical across', Object.keys(dumped.out).length, 'values');
