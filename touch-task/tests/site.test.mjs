// Checks that catch common mistakes before anything is published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
const sw = await read('sw.js');
const files = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every file listed in sw.js exists (otherwise offline install fails)', async () => {
  for (const f of files.filter((f) => f !== './')) await access(new URL(`../${f}`, import.meta.url));
});

test('every script, stylesheet, manifest and icon the page uses is cached for offline', async () => {
  const html = await read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => './' + m[1].replace(/^\.\//, ''));
  for (const r of refs) assert.ok(files.includes(r), `${r} is used by index.html but missing from FILES in sw.js`);
  for (const f of ['./ble.mjs', './rewards.mjs']) assert.ok(files.includes(f), `${f} missing from FILES in sw.js`);
});

test('CACHE_VERSION in sw.js matches appVersion in config.js', async () => {
  const config = await read('config.js');
  const cacheVersion = sw.match(/const CACHE_VERSION = 'v([^']+)'/)[1];
  const appVersion = config.match(/appVersion: '([^']+)'/)[1];
  assert.equal(cacheVersion, appVersion, 'bump both together');
});
