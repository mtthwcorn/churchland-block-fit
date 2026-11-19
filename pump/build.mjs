import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const out = new URL('dist/pump/', root);
await rm(out, {recursive:true, force:true});
await mkdir(out, {recursive:true});
const hash = createHash('sha256');
const files = ['index.html','style.css','app.mjs','button-link.mjs','setup.html','ble.mjs'];
for (const name of files) {
  let contents = await readFile(new URL(name === 'ble.mjs' ? 'game/ble.mjs' : `pump/${name}`, root), 'utf8');
  if (name === 'button-link.mjs') contents = contents.replace("'../game/ble.mjs'", "'./ble.mjs'");
  hash.update(contents);
  await writeFile(new URL(name, out), contents);
}

// Small, uncompressed ZIP using the standard ZIP32 format. No build-time tools/dependencies.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}
const local = [], central = [];
let offset = 0;
const firmware = ['pump_ble.ino','PumpControl.h','ButtonControl.h'];
for (const file of [...firmware, 'README.md']) {
  const bytes = await readFile(new URL(file === 'README.md' ? 'firmware/README.md' : `firmware/pump_ble/${file}`, root));
  const name = Buffer.from(`pump_ble/${file}`);
  const checksum = crc32(bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4);
  header.writeUInt16LE(33,12); // DOS date 1980-01-01, deterministic archive.
  header.writeUInt32LE(checksum,14); header.writeUInt32LE(bytes.length,18);
  header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(name.length,26);
  local.push(header,name,bytes);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50,0); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6);
  entry.writeUInt16LE(33,14); entry.writeUInt32LE(checksum,16);
  entry.writeUInt32LE(bytes.length,20); entry.writeUInt32LE(bytes.length,24);
  entry.writeUInt16LE(name.length,28); entry.writeUInt32LE(offset,42);
  central.push(entry,name); offset += header.length + name.length + bytes.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(4,8); end.writeUInt16LE(4,10);
end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
const archive = Buffer.concat([...local,directory,end]);
await writeFile(new URL('pump-button-firmware.zip',out),archive);
hash.update(archive);
files.push('pump-button-firmware.zip');
const version = hash.digest('hex').slice(0,12);
await writeFile(new URL('sw.js',out), `const CACHE='eric-button-${version}';
const FILES=${JSON.stringify(['./',...files.map(f=>'./'+f)])};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('eric-button-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);
if(e.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./',self.location).pathname))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}return r;}).catch(async()=>await caches.match(e.request)||(e.request.mode==='navigate'?await caches.match('./index.html'):Response.error())));});
`);
console.log('Built juice button at /pump/ with firmware download and offline support.');
