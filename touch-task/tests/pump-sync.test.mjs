// The touch task must speak exactly the same pump protocol as Block Fit.
// Its copies of ble.mjs and rewards.mjs must stay byte-for-byte identical to
// Block Fit's (game/ble.mjs, game/rewards.mjs). If Block Fit's pump code is
// updated, this test fails until the new versions are copied into touch-task/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const f of ['ble.mjs', 'rewards.mjs']) {
  test(`touch-task/${f} is identical to Block Fit's game/${f}`, async () => {
    const ours = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    const blockFit = await readFile(new URL(`../../game/${f}`, import.meta.url), 'utf8');
    assert.equal(ours, blockFit, `copy game/${f} over touch-task/${f}`);
  });
}
