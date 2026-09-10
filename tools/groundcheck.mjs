// groundcheck.mjs — the guard for the two grounds.
//
//   npm i playwright                   (not vendored; this is the only thing that needs it)
//   python3 -m http.server 8899        (from the repo root)
//   node tools/groundcheck.mjs         the black ground
//   node tools/groundcheck.mjs bone    the bone ground
//
// Walks all five tabs, opens every collapsed group, and for every element that holds text
// composites its real backdrop stack down to the page's ground before measuring. That is
// the part that matters: a token can be right and still fail because the thing it sits in
// re-declared the ground under it. Prints the resolved colours, not just the ratio, so a
// failure says what went wrong rather than only where.
//
// Known and pre-existing on both grounds: "Clear all data" (3.88) and the colophon's
// "(v.)" (4.38). Bone should be 0.
//
// If you add a --reverse-bg fill, it will show up here as 1:1 until it is added to the
// :is() list in the bone block.
//
// A SECOND PASS FOR STATES THE PAGE AT REST DOES NOT SHOW. Two ground bugs shipped past
// this file because a walk of the rendered page never reaches them: a destructive button
// only becomes a --reverse-bg pocket for the four seconds it is armed, and a skill rung
// only becomes a filled band once you have ticked it. Both were black on black on bone.
// The states pass puts the app into those states deliberately and measures again, so
// anything whose colours only exist under a class or a timer is covered too. Add to
// applyStates when you add a state that repaints something.
import { chromium } from 'playwright';
const ground = process.argv[2] || '';
const MEASURE = `(()=>{
  const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  const lum=c=>{const[r,g,b]=c.map(lin);return 0.2126*r+0.7152*g+0.0722*b;};
  const parse=s=>{const m=(s||'').match(/rgba?\\(([^)]+)\\)/);if(!m)return null;
    const q=m[1].split(/[,\\s\\/]+/).filter(Boolean).map(parseFloat);
    return {rgb:[q[0],q[1],q[2]], a:q.length>3?q[3]:1};};
  const over=(f,bg)=>f.rgb.map((v,i)=>v*f.a+bg[i]*(1-f.a));
  // the page's true base, whatever the ground is
  const root=parse(getComputedStyle(document.documentElement).backgroundColor);
  const bodyBg=parse(getComputedStyle(document.body).backgroundColor);
  let PAGE=[251,250,246];
  const gv=getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  if(gv){const d=document.createElement('div');d.style.color=gv;document.body.appendChild(d);
    const c=parse(getComputedStyle(d).color); d.remove(); if(c)PAGE=c.rgb;}
  const bgOf=el=>{let n=el,st=[];
    while(n&&n!==document.documentElement){const c=parse(getComputedStyle(n).backgroundColor);
      if(c&&c.a>0)st.push(c); n=n.parentElement;}
    let base=PAGE.slice(); for(let i=st.length-1;i>=0;i--)base=over(st[i],base); return base;};
  const out=[];
  document.querySelectorAll('body *').forEach(el=>{
    const t=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
    if(!t) return;
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||el.offsetParent===null||+cs.opacity===0) return;
    const r0=el.getBoundingClientRect(); if(r0.width<2||r0.height<2) return;
    const f=parse(cs.color); if(!f) return;
    const bg=bgOf(el); const fg=over(f,bg);
    const L1=lum(fg),L2=lum(bg);
    const r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const big = parseFloat(cs.fontSize)>=24 || (parseFloat(cs.fontSize)>=18.66 && +cs.fontWeight>=700);
    const hex=c=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
    if(r < (big?3:4.5)) out.push({r:+r.toFixed(2), need:big?3:4.5, fg:hex(fg), bg:hex(bg),
      why:(st=>st)(''),
      cls:(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||'').toString().split(' ').slice(0,2).join('.'),
      tag:el.tagName.toLowerCase(), txt:t.slice(0,44)});
  });
  return out;
})()`;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:393,height:1100}, reducedMotion:'reduce' });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const URL='http://localhost:8899/index.html?cb='+Date.now();
await p.goto(URL); await p.waitForFunction(()=>!!window.storage,{timeout:20000});
const todayStr = await p.evaluate(()=>todayStr);
await p.evaluate(async d=>{ await seedTestScenario('well_recovered');
  await window.storage.set('settings:trainingSetup', JSON.stringify({availableDays:['Mon','Tue','Wed','Thu','Fri'],sessionLength:'60',multiSessionOk:false}));
  await window.storage.set(`morningAsked:${d}`, JSON.stringify({at:Date.now()})); }, todayStr);
await p.goto(URL); await p.waitForFunction(()=>!!window.storage,{timeout:20000});
await p.waitForTimeout(2600);
if(ground) await p.evaluate(g=>document.documentElement.dataset.ground=g, ground);
await p.waitForTimeout(400);
// Transient dressing, applied on purpose. Arming is the app's own call rather than a
// hand-painted imitation, so what gets measured is what a finger would actually produce;
// it resolves false on its own timer and clears nothing. Returns how many states it found,
// because a pass that silently applied none is a pass that proves nothing.
const applyStates = `(()=>{
  let n = 0;
  // The skill ladders open on the rung you are on and the one above it, with the rest behind
  // "show all". A walk of the page therefore never saw the other seven, and the states pass
  // that ticks them dropped from 40 rows to 16 the day that landed. Expanded first, so the
  // whole ladder is measured rather than the two rungs that happen to be showing.
  document.querySelectorAll('.mob-check-more').forEach(b=>{
    if(/show all/i.test(b.textContent || '')){ b.click(); n++; }
  });
  document.querySelectorAll('.mob-check-row:not(.done):not(.prereq)').forEach(r=>{ r.classList.add('done'); n++; });
  // Weekly is behind a pill on Training and the walk only ever saw Daily, so the week board,
  // its lanes and the day sheet were never measured on either ground. Clicked here, which is
  // the pass that runs before the second MEASURE.
  const weekly = document.querySelector('#trainingViewPills [data-view="weekly"]');
  if(weekly && !weekly.classList.contains('active')){ weekly.click(); n++; }
  const btn = document.getElementById('clearAllWeekBtn') || document.getElementById('clearAllDataBtn');
  if(btn && typeof confirmInPlace === 'function' && btn.dataset.arming !== '1'){
    confirmInPlace(btn, { mode:'tap', label:'Tap again to confirm' }); n++;
  }
  // A sheet is display:none until you open it, so everything in it is invisible to a walk of
  // the page. The goals sheet holds a whole form and shipped cream-on-cream on bone for
  // exactly that reason. Opened, not closed again: it is measured every round from here on.
  document.querySelectorAll('.lift-sheet, .morning-sheet').forEach(sh=>{
    if(sh.style.display === 'none'){ sh.style.display = ''; n++; }
  });
  return n;
})()`;
const seen=new Map();
let stateCount = 0;
for(const tab of ['insights','training','injuries','data','settings']){
  await p.evaluate(x=>activateTab(x), tab); await p.waitForTimeout(1000);
  await p.evaluate(()=>{ document.querySelectorAll('.group-head').forEach(h=>{
      const nb=h.nextElementSibling; if(nb&&getComputedStyle(nb).display==='none') h.click(); });
    document.querySelectorAll('details:not([open])').forEach(d=>{ if(d.offsetParent!==null) d.open=true; }); });
  await p.waitForTimeout(700);
  for(const f of await p.evaluate(MEASURE)){
    const k=`${f.cls}|${f.txt}`;
    if(!seen.has(k)) seen.set(k,{...f, tab});
  }
  // Second pass, same tab, with the states on. Measured immediately: the armed button puts
  // itself back after four seconds.
  stateCount += await p.evaluate(applyStates);
  await p.waitForTimeout(250);
  for(const f of await p.evaluate(MEASURE)){
    const k=`${f.cls}|${f.txt}`;
    if(!seen.has(k)) seen.set(k,{...f, tab:tab+'*'});
  }
}
const list=[...seen.values()].sort((a,b)=>a.r-b.r);
console.log(`ground=${ground||'dark'}  failures=${list.length}`);
for(const f of list) console.log(`  ${String(f.r).padStart(5)}:1  ${f.fg} on ${f.bg}  ${f.tab.padEnd(9)} ${(f.tag+'.'+f.cls).padEnd(30)} "${f.txt}"`);
console.log(`states applied: ${stateCount}${stateCount ? '' : '  <- none found; the states pass measured nothing'}`);
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'none');
await b.close();
