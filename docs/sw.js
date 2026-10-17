const CACHE = 'libresconductores-v13';
self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './datos.js', './manifest.json', './icon.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const u = e.request.url;
    if (u.includes('firebase') || u.includes('gstatic') || u.includes('googleapis')) return;
    e.respondWith(fetch(e.request).then(r => {
        if (r && r.status === 200) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
        return r;
    }).catch(() => caches.match(e.request)));
});
