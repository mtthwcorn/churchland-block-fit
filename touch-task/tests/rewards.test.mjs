// Copied unchanged from Block Fit's tests/game.test.mjs (the reward and pulse tests only).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PUMP_ML_PER_MINUTE, PUMP_ML_PER_SECOND, rewardPlan, PulseRunner} from '../rewards.mjs';
test('every reward uses the fixed 90 mL/min rate; rewards use whole-millisecond pulse durations', () => {
  assert.equal(PUMP_ML_PER_MINUTE,90); assert.equal(PUMP_ML_PER_SECOND,1.5);
  assert.equal(rewardPlan(1.5).durationMs,1000);
  assert.equal(rewardPlan(.5,3).durationMs,1000);
  assert.equal(rewardPlan(.5,3).volume,1.5);
  assert.equal(rewardPlan(1.5,8).durationMs,8000);
});
test('firmware pulse limits reject invalid amounts and overlong combined rewards', () => {
  for (const volume of [0,-1,NaN,Infinity,.149,90.001]) assert.throws(()=>rewardPlan(volume));
  for (const merges of [0,-1,1.5,9,NaN]) assert.throws(()=>rewardPlan(1.5,merges));
  assert.equal(rewardPlan(.15).durationMs,100);
  assert.equal(rewardPlan(90).durationMs,60000);
  assert.equal(rewardPlan(11.25,8).durationMs,60000);
  assert.throws(()=>rewardPlan(11.251,8),/60 seconds/);
});
test('the duration is rounded to whole milliseconds without changing the fixed rate', () => {
  const plan = rewardPlan(1);
  assert.equal(plan.durationMs,667); assert.equal(plan.requestedMl,1);
  assert.ok(Math.abs(plan.volume - 1.0005) < 1e-9);
});
function pulseFixture() {
  let clock=0;
  const link = new EventTarget(); link.phase='idle'; link.pending=''; link.calls=[];
  link.state = phase => { link.phase=phase;link.dispatchEvent(new Event('change')); };
  link.run=async seconds=> {link.calls.push(seconds);link.state('running');};
  link.stop=async()=>link.state('idle');link.drop=message=>{link.message=message;link.state('offline');};
  return {link,runner:new PulseRunner(link,()=>clock),time:n=>{clock=n;}};
}
test('pulse waits for board start and stop acknowledgment; no overlap is possible', async () => {
  const f=pulseFixture();const result=f.runner.pulse(.4);
  assert.equal(f.runner.busy,true); await assert.rejects(f.runner.pulse(.4),/not ready/);
  f.time(400);f.link.state('idle');await result;
  assert.equal(f.runner.busy,false); assert.deepEqual(f.link.calls,[.4]);
});
test('premature stops and disconnects do not count as a completed reward', async () => {
  const f=pulseFixture();const p=f.runner.pulse(10);f.time(1000);f.link.state('idle');await assert.rejects(p,/early/);
  const second=f.runner.pulse(1);f.link.drop('Disconnected');await assert.rejects(second,/Disconnected/);
  assert.equal(f.runner.busy,false);
});
test('Stop rejects pending pulse and sends a stop without replaying it', async () => {
  const f=pulseFixture();const p=f.runner.pulse(1);const rejected=assert.rejects(p,/stopped/);
  await f.runner.stop();await rejected;assert.equal(f.link.phase,'idle');assert.deepEqual(f.link.calls,[1]);
});
