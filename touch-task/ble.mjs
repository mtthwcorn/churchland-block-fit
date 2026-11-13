export const SERVICE = '3e61a100-27c5-4b4a-a89d-72b7b1478420';
export const COMMAND = '3e61a101-27c5-4b4a-a89d-72b7b1478420';
export const STATUS = '3e61a102-27c5-4b4a-a89d-72b7b1478420';
export function timedRunPacket(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0.1 || seconds > 60)
    throw new RangeError('Choose a duration from 0.1 to 60 seconds.');
  const packet = new Uint8Array(5);
  packet[0] = 4;
  new DataView(packet.buffer).setUint32(1, Math.round(seconds * 1000), true);
  return packet;
}

export class PumpLink extends EventTarget {
  constructor(bluetooth = globalThis.navigator?.bluetooth) {
    super();
    this.bluetooth = bluetooth;
    this.phase = 'offline';
    this.pending = '';
    this.message = '';
    this.runDurationMs = 2000;
    this.queue = Promise.resolve();
    this.epoch = 0;
    this.runVersion = 0;
    this.onValue = event => this.acceptState(event.target.value);
    this.onDisconnect = () => this.drop('Bluetooth disconnected.');
  }
  emit() { this.dispatchEvent(new Event('change')); }
  async bounded(promise, ms = 1800) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Arduino did not respond. Reconnect to try again.')), ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  enqueue(operation) {
    const epoch = this.epoch;
    const result = this.queue.catch(() => {}).then(() => {
      if (epoch !== this.epoch || !this.device?.gatt.connected) throw new Error('Bluetooth disconnected.');
      return this.bounded(operation());
    });
    this.queue = result;
    return result;
  }
  write(value, guard = () => true) {
    return this.enqueue(() => guard() ? this.command.writeValueWithResponse(value instanceof Uint8Array ? value : Uint8Array.of(value)) : undefined);
  }
  readState() {
    return this.enqueue(async () => this.acceptState(await this.status.readValue()));
  }
  acceptState(value) {
    if (!value || value.byteLength !== 1 || value.getUint8(0) > 1) {
      this.drop('Unexpected device reply. Reconnect to Eric Pump.');
      return;
    }
    if (this.phase === 'connecting' || this.phase === 'offline') return;
    if (value.getUint8(0) === 1) {
      if (this.phase !== 'running') this.startedAt = performance.now();
      this.phase = 'running';
      if (this.pending === 'run') this.pending = '';
      this.message = '';
    } else {
      this.phase = 'idle';
      this.pending = '';
      this.clearRunTimers();
      this.message = '';
    }
    this.emit();
  }
  async connect() {
    if (!this.bluetooth || this.phase !== 'offline') return;
    this.phase = 'connecting';
    this.message = '';
    this.emit();
    const epoch = ++this.epoch;
    try {
      // Keep requestDevice directly in the click's user-activation context.
      const device = await this.bluetooth.requestDevice({filters: [{services: [SERVICE]}]});
      if (epoch !== this.epoch) return;
      this.device = device;
      device.addEventListener('gattserverdisconnected', this.onDisconnect);
      const server = await this.bounded(device.gatt.connect(), 12000);
      const ensureCurrent = () => {
        if (epoch !== this.epoch) {
          device.gatt.disconnect();
          throw new Error('Connection cancelled.');
        }
      };
      ensureCurrent();
      const service = await this.bounded(server.getPrimaryService(SERVICE), 6000);
      ensureCurrent();
      const command = await this.bounded(service.getCharacteristic(COMMAND), 6000);
      ensureCurrent();
      const status = await this.bounded(service.getCharacteristic(STATUS), 6000);
      ensureCurrent();
      this.command = command;
      this.status = status;
      this.status.addEventListener('characteristicvaluechanged', this.onValue);
      await this.bounded(this.status.startNotifications(), 6000);
      await this.write(0); // Connecting never starts a motor.
      const initial = await this.enqueue(() => this.status.readValue());
      if (epoch !== this.epoch) return;
      this.phase = 'checking';
      this.acceptState(initial);
      if (this.phase !== 'idle') throw new Error('The pump did not confirm a stop. Switch off its battery.');
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.drop(error.name === 'NotFoundError' ? 'No pump selected. Tap Connect to try again.' : this.friendly(error));
    }
  }
  friendly(error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      return 'Allow Bluetooth for this site in Chrome, then connect again.';
    if (error.name === 'NetworkError')
      return 'Connection failed. Keep the Arduino powered and nearby, then reconnect.';
    return error.message || 'Could not connect. Please try again.';
  }
  clearRunTimers() {
    clearInterval(this.heartbeat);
    clearTimeout(this.ackTimer);
    clearTimeout(this.finishTimer);
    this.heartbeat = this.ackTimer = this.finishTimer = null;
  }
  async run(seconds = 2) {
    if (this.phase !== 'idle' || this.pending) return;
    let packet;
    try { packet = timedRunPacket(seconds); }
    catch (error) { this.message = error.message; this.emit(); return; }
    this.runDurationMs = new DataView(packet.buffer).getUint32(1, true);
    const epoch = this.epoch;
    const version = ++this.runVersion;
    this.pending = 'run';
    this.message = '';
    this.emit();
    this.heartbeat = setInterval(() => {
      if (this.heartbeatBusy || this.pending === 'stop') return;
      this.heartbeatBusy = true;
      this.write(2, () => version === this.runVersion && (this.phase === 'running' || this.pending === 'run'))
        .catch(error => { if (epoch === this.epoch) this.drop(this.friendly(error)); })
        .finally(() => { this.heartbeatBusy = false; });
    }, 250);
    this.ackTimer = setTimeout(() => {
      if (this.pending === 'run') this.drop('No start confirmation. Reconnect before another test.');
    }, 1600);
    this.finishTimer = setTimeout(() => {
      if (this.phase === 'running' || this.pending) this.drop('No stop confirmation. Check the pump and reconnect.');
    }, this.runDurationMs + 1800);
    try {
      await this.write(packet, () => version === this.runVersion && this.pending === 'run');
    } catch (error) { if (epoch === this.epoch) this.drop(this.friendly(error)); }
  }
  async stop() {
    if (!this.device?.gatt.connected || !this.command || this.phase === 'connecting') return;
    const epoch = this.epoch;
    ++this.runVersion; // Cancels a queued start before queuing the stop.
    this.clearRunTimers();
    this.pending = 'stop';
    this.message = '';
    this.emit();
    try {
      await this.write(0);
      if (epoch !== this.epoch) return;
      await this.readState();
      if (this.phase !== 'idle') throw new Error('Stop was not confirmed. Switch off the motor battery.');
    } catch (error) { if (epoch === this.epoch) this.drop(this.friendly(error)); }
  }
  async disconnect() {
    if (this.device?.gatt.connected && this.phase !== 'connecting') await this.stop();
    this.drop('');
  }
  drop(message) {
    ++this.epoch;
    ++this.runVersion;
    this.clearRunTimers();
    this.status?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect);
    this.device?.gatt.disconnect(); // Board also stops on disconnect or a missing heartbeat.
    this.device = this.command = this.status = null;
    this.queue = Promise.resolve();
    this.pending = '';
    this.phase = 'offline';
    this.message = message;
    this.emit();
  }
}
