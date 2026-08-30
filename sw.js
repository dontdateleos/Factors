/* Factors — service worker.

   index.html has tried to register this file since the update checker was written, and it
   has never existed, so every register() call rejected and was swallowed. That left the one
   thing standing between a home-screen app and a stale build entirely to iOS's own HTML
   cache and whatever headers GitHub Pages happens to send — neither of which this app
   controls, and both of which will happily re-serve a document from weeks ago.

   The rule here is one line long and it is the whole point: THE DOCUMENT IS NETWORK-FIRST.
   A page load asks the network, and only falls back to the cached copy if the network is
   genuinely unavailable. That is the opposite of the usual offline-first recipe, and it is
   deliberate: this is a single 1.3MB file that changes several times a day, and a cache-first
   worker would pin whichever build was installed first and never let go. Offline still works
   — the fallback is a real copy of the last page that loaded — but being offline is the
   exception rather than the strategy.

   Everything is defensive. Any throw inside the fetch handler falls through to the network,
   so a bug in here costs the offline fallback rather than the app. */

const CACHE = 'factors-doc-v1';
const NET_TIMEOUT_MS = 6000;   // a slow network should not out-wait a usable cached copy

self.addEventListener('install', (e)=>{
  // Take over as soon as the new worker is ready rather than waiting for every tab to close.
  // A home-screen app is resumed rather than closed, so "when all tabs close" can be never.
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const names = await caches.keys();
    await Promise.all(names.filter(n=> n !== CACHE).map(n=> caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request){
  const cache = await caches.open(CACHE);
  try{
    // Timed, so a hanging request cannot leave the page blank when a good copy is on disk.
    const controller = new AbortController();
    const timer = setTimeout(()=> controller.abort(), NET_TIMEOUT_MS);
    // cache:'no-store' keeps the HTTP cache out of it as well — the whole reason this exists
    // is that something upstream was answering with an old document.
    const res = await fetch(request, { cache:'no-store', signal:controller.signal });
    clearTimeout(timer);
    if(res && res.ok){
      // Keyed on the path without its query, so ?v= and ?updatecheck= busters do not each
      // write their own entry and the fallback is always the latest good document.
      cache.put(new Request(new URL(request.url).pathname), res.clone()).catch(()=>{});
      return res;
    }
    throw new Error('bad response ' + (res && res.status));
  } catch(e){
    const hit = await cache.match(new Request(new URL(request.url).pathname));
    if(hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (e)=>{
  try{
    const req = e.request;
    if(req.method !== 'GET') return;
    const url = new URL(req.url);
    if(url.origin !== self.location.origin) return;   // Oura, fonts, anything else: untouched
    // Only the document. There is nothing else to cache — the app is one file — and leaving
    // every other request alone means this worker cannot break anything it does not serve.
    const isDoc = req.mode === 'navigate'
      || (req.destination === 'document')
      || url.pathname.endsWith('.html')
      || url.pathname.endsWith('/');
    if(!isDoc) return;
    e.respondWith(networkFirst(req));
  } catch(err){ /* fall through to the network */ }
});

// The page asks for this after an update check so it can tell you which build it is talking
// to, and to drop the cached document on demand.
self.addEventListener('message', (e)=>{
  if(!e.data) return;
  if(e.data.type === 'skipWaiting') self.skipWaiting();
  if(e.data.type === 'dropCache') caches.delete(CACHE).catch(()=>{});
});
