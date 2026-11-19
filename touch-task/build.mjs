// =============================================================================
// build.mjs: makes the deployable copy of the touch task
// -----------------------------------------------------------------------------
// The touch task lives in the touch-task/ folder of the Block Fit repository
// and is published on the same Vercel site, at /touch-task/. The repository's
// vercel.json runs Block Fit's tests and build, then this folder's tests, then:
//     node touch-task/build.mjs dist/touch-task
// If any test fails, nothing is published and the current site stays live.
//
// Usage:  node build.mjs [output folder]
//   With no folder given, it builds into touch-task/dist/ for local testing.
//
// What this does:
//   1. Reads the FILES list from sw.js, so there is one list of the site's files.
//   2. Copies exactly those files into dist/ (tests, README etc. stay out).
//   3. Adds a fingerprint of the files' contents to the cache name in
//      dist/sw.js. So on Vercel, ANY change to ANY file makes tablets fetch
//      the new version, even if you forgot to bump CACHE_VERSION.
//      (On GitHub Pages there is no build step, so bumping it by hand still
//      matters there.)
//
// Run it yourself with:  node build.mjs   (needs Node.js 22; no packages)
// =============================================================================
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
// Output folder: the first argument (relative to where you run it), or ./dist
const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, 'dist');

const sw = await readFile(join(root, 'sw.js'), 'utf8');
const listMatch = sw.match(/const FILES = \[([\s\S]*?)\];/);
if (!listMatch) throw new Error('Could not find the FILES list in sw.js');
const files = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './');

await rm(out, { recursive: true, force: true });
const hash = createHash('sha256');
for (const f of files) {
  const src = join(root, f);
  const dest = join(out, f);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  hash.update(f).update(await readFile(src));
}
const fingerprint = hash.digest('hex').slice(0, 10);

const cacheLine = 'const CACHE_NAME = `nhp-touch-task-${CACHE_VERSION}`;';
if (!sw.includes(cacheLine)) throw new Error('Could not find the CACHE_NAME line in sw.js');
await writeFile(join(out, 'sw.js'), sw.replace(cacheLine, `const CACHE_NAME = \`nhp-touch-task-\${CACHE_VERSION}-${fingerprint}\`;`));

console.log(`Built the touch task (${files.length} files) into ${out} (cache fingerprint ${fingerprint}).`);
