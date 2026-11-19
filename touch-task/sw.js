// =============================================================================
// sw.js — SERVICE WORKER: makes the app work with no internet
// -----------------------------------------------------------------------------
// The first time the tablet opens the app on Wi-Fi, this script downloads
// every file in FILES into a cache on the tablet. After that, whenever the app
// asks for a file, the copy from the cache is used — so it runs offline.
//
// >>> WHEN YOU CHANGE ANY FILE: bump CACHE_VERSION below (e.g. v0.1.0 -> v0.1.1)
// >>> and appVersion in config.js. Then open the app on Wi-Fi, close it
// >>> completely, and open it again. The new version is now cached.
// >>> (If you don't bump it, the tablet keeps the old copy forever.)
//
// If you ADD a new file to the app, also add it to FILES.
// =============================================================================

const CACHE_VERSION = 'v0.4.0';
const CACHE_NAME = `nhp-touch-task-${CACHE_VERSION}`;

const FILES = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './storage.js',
  './task.js',
  './ble.mjs',
  './rewards.mjs',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Install: download every file into the new cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()) // take over without waiting for old tabs to close
  );
});

// Activate: delete caches from older versions. (Your DATA is not in here —
// it lives in IndexedDB — so this never touches recorded trials.)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith('nhp-touch-task-') && n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: answer from the cache first; only go to the network if a file isn't
// cached. Exception: the online clock check must reach the real server.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.searchParams.has('clockcheck')) return; // let it go to the network

  // Look only in THIS app's cache. (If the app shares a website with another
  // app, e.g. Block Fit, that app's caches must never answer for ours.)
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(event.request, { ignoreSearch: true }))
      .then((cached) => cached || fetch(event.request))
  );
});
