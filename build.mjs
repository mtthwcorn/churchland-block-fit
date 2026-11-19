import {readFile, writeFile, mkdir} from 'node:fs/promises';
const readGame = file => readFile(new URL(`game/${file}`, import.meta.url), 'utf8');
const [html, css, ...modules] = await Promise.all(['index.html', 'style.css', 'ble.mjs', 'engine.mjs', 'rewards.mjs', 'app.mjs'].map(readGame));
const js = modules.map(source => source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).join('\n');
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error('Unsafe inline delimiter');
const output = new URL('dist/', import.meta.url);
await mkdir(output, {recursive: true});
await writeFile(new URL('index.html', output), html.replace('<!-- STYLES -->', `<style>${css}</style>`).replace('<!-- SCRIPT -->', `<script type="module">${js}</script>`));
await writeFile(new URL('icon.svg', output), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#185c43"/><rect x="30" y="30" width="84" height="84" rx="10" fill="#e6b94d"/><rect x="126" y="30" width="36" height="84" rx="9" fill="#76b58b"/><rect x="30" y="126" width="132" height="36" rx="9" fill="#7aabd8"/></svg>');
await writeFile(new URL('manifest.webmanifest', output), JSON.stringify({name: 'Block fit · Pump play', short_name: 'Block fit', start_url: './', scope: './', display: 'standalone', background_color: '#f2f4f2', theme_color: '#185c43', icons: [{src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any'}]}));
await writeFile(new URL('sw.js', output), `const CACHE = 'churchland-block-fit-v3';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg']))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('churchland-block-fit-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/pump/') || url.pathname.startsWith('/touch-task/')) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('./') : Response.error())));
});\n`);
console.log('Built Block fit as a portable static page with offline support.');
