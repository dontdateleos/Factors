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
/* ONE DOCUMENT, ONE KEY.

   The fallback used to be filed under the request's pathname. Stripping the query was right
   and still is — ?v= and ?updatecheck= busters share one entry — but the pathname itself was
   not normalised, and "/" and "/index.html" are two spellings of the same file. Measured by
   loading /index.html and then killing the server: /index.html, /index.html?v=9 and
   /index.html?updatecheck=1 all served the app, and "/" got ERR_FAILED and no app at all —
   a browser error page with the whole thing in cache a few bytes away under another key.

   This worker only ever serves one document, which is what the strategy note above already
   says, so it only ever needs one key. Built from self.location so it lands inside the
   worker's own scope and cannot collide with a real path. */
const DOC_KEY = new Request(new URL('__factors-document', self.location).toString());
/* The font is the one other thing the page needs, and it came from a third party that an
   offline phone cannot reach — so an offline launch had the document and no typeface. It
   gets its own cache, and the opposite strategy to the document: CACHE-FIRST, because a
   font file at a versioned URL never changes, and revalidated in the background so a new
   weight is picked up without anyone waiting for it. */
const FONT_CACHE = 'factors-font-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_TIMEOUT_MS = 6000;   // a slow network should not out-wait a usable cached copy

self.addEventListener('install', (e)=>{
  // Take over as soon as the new worker is ready rather than waiting for every tab to close.
  // A home-screen app is resumed rather than closed, so "when all tabs close" can be never.
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const names = await caches.keys();
    await Promise.all(names.filter(n=> n !== CACHE && n !== FONT_CACHE).map(n=> caches.delete(n)));
    await self.clients.claim();
    await warmDocument();
  })());
});

/* THE OFFLINE COPY IS THIS WORKER'S JOB, NOT A SIDE EFFECT OF SOMETHING THE PAGE DID.

   The document that bootstraps a first load is requested before this worker exists, so it
   never passes through here. Until now the cache was filled by whichever page request
   happened to arrive after clients.claim() — in practice the update check, entirely by
   accident. 2026.08.31.230 removed that check on first install for good reasons and left a
   fresh install with an empty cache nine seconds in, which is what showed who had really
   been doing this.

   Runs once per worker version, and only when there is nothing cached: from the second
   launch onwards the page's own document request fills it, and this should not spend a
   second copy to do what that already did. index.html by name because this app is one
   file with that name — the scope root is a directory on some servers and would cache a
   listing as the offline document. */
async function warmDocument(){
  try{
    const cache = await caches.open(CACHE);
    if(await cache.match(DOC_KEY)) return;
    const res = await fetch(new URL('index.html', self.registration.scope).toString(), { cache:'no-store' });
    if(res && res.ok) await cache.put(DOC_KEY, res);
  } catch(e){}
}

async function cacheFirstFont(request){
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(request);
  if(hit){
    // Revalidate without blocking on it: the cached copy is already on its way to the page.
    fetch(request).then(res=>{ if(res && res.ok) cache.put(request, res.clone()).catch(()=>{}); }).catch(()=>{});
    return hit;
  }
  const res = await fetch(request);
  if(res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(()=>{});
  return res;
}

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
      // One key for the one document, so the fallback is always the latest good copy however
      // the address that fetched it happened to be spelled.
      cache.put(DOC_KEY, res.clone()).catch(()=>{});
      return res;
    }
    throw new Error('bad response ' + (res && res.status));
  } catch(e){
    const hit = await cache.match(DOC_KEY);
    if(hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (e)=>{
  try{
    const req = e.request;
    if(req.method !== 'GET') return;
    const url = new URL(req.url);
    // The font is the one cross-origin thing worth holding: without it an offline launch
    // renders in the fallback stack forever. Everything else cross-origin — Oura, the token
    // worker — is left alone, because caching a data API is how you serve stale readings.
    if(FONT_HOSTS.includes(url.hostname)){ e.respondWith(cacheFirstFont(req)); return; }
    if(url.origin !== self.location.origin) return;   // Oura, anything else: untouched
    /* The page's version poll is not a page load and must not be answered from here. It asks
       the server, carrying a validator, precisely to find out whether the served copy has
       moved — and a 304 is the answer it wants. Passing it through networkFirst turned that
       304 into "bad response", fell back to the cached document, and handed the page a 200
       it then had to read a megabyte and a half of to learn nothing. */
    if(url.searchParams.has('updatecheck')) return;
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

/* Drop the cached document on demand. applyUpdate sends this before navigating, so the
   reload cannot be answered from the very copy it is trying to leave.
   There used to be a skipWaiting message here too, and a comment saying the page asked for
   this after an update check so it could tell you which build it was talking to. Neither was
   true: nothing in the page has ever posted skipWaiting — the install handler above already
   calls it — and nothing asks this worker which build it holds or displays the answer. A
   comment describing a capability the file does not have is worse than no comment, because
   it is what you would read before deciding the worker was fine. */
self.addEventListener('message', (e)=>{
  if(e.data && e.data.type === 'dropCache') caches.delete(CACHE).catch(()=>{});
});
