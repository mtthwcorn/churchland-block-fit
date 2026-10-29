export const PUMP_ML_PER_MINUTE = 90;
export const PUMP_ML_PER_SECOND = PUMP_ML_PER_MINUTE / 60;

export function rewardPlan(ml, merges = 1) {
  if (!Number.isFinite(ml) || ml < .15 || ml > 90) throw new Error('Enter 0.15–90 mL per trial.');
  if (!Number.isInteger(merges) || merges < 1 || merges > 8) throw new Error('Invalid merge count.');
  const singleMs = ml / PUMP_ML_PER_SECOND * 1000;
  const durationMs = Math.round(singleMs * merges);
  if (durationMs > 60000) throw new Error('This move needs more than 60 seconds. Reduce the reward volume.');
  return {durationMs, volume: durationMs / 1000 * PUMP_ML_PER_SECOND, requestedMl: ml * merges, merges};
}

export class PulseRunner {
  constructor(link, now = () => performance.now()) { this.link = link; this.now = now; this.busy = false; }
  pulse(seconds) {
    if (this.busy || this.link.phase !== 'idle' || this.link.pending)
      return Promise.reject(new Error('The pump is not ready. Reconnect or wait for it to stop.'));
    if (!Number.isFinite(seconds) || seconds < .1 || seconds > 60)
      return Promise.reject(new Error('A pulse must be between 0.1 and 60 seconds.'));
    this.busy = true;
    return new Promise((resolve, reject) => {
      let started = null;
      const cleanup = () => {
        this.link.removeEventListener('change', changed);
        clearTimeout(timeout);
        this.cancel = null;
        this.busy = false;
      };
      const fail = message => { cleanup(); reject(new Error(message)); };
      const changed = () => {
        if (this.link.phase === 'offline') return fail(this.link.message || 'Pump disconnected.');
        if (this.link.phase === 'running' && started === null) started = this.now();
        if (this.link.phase === 'idle' && !this.link.pending && started !== null) {
          const elapsed = this.now() - started;
          // A premature stop may be a heartbeat expiry, not a completed reward.
          if (elapsed < seconds * 1000 - Math.min(150, seconds * 100))
            return fail('The pump stopped early. Check the connection before continuing.');
          cleanup(); resolve();
        }
      };
      const timeout = setTimeout(() => {
        fail('The pump did not confirm the full pulse. Reconnect before continuing.');
        this.link.drop('Pulse confirmation timed out.');
      }, seconds * 1000 + 3500);
      this.cancel = () => fail('Pulse stopped. Resume when ready; interrupted rewards will not replay.');
      this.link.addEventListener('change', changed);
      this.link.run(seconds).catch(error => fail(error.message));
    });
  }
  async stop() {
    this.cancel?.();
    await this.link.stop();
  }
}
