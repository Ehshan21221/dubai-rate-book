const CACHE = "dubai-rate-book-v1";
const CORE_FILES = ["./", "./index.html", "./style.css", "./app.js", "./firebase-config.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for everything (Firestore/OpenRouter calls must not be cached);
// fall back to cache only for the core app shell when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let Firebase/OpenRouter requests pass straight through
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
