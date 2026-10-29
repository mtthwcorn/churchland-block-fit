import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PumpLink, SERVICE, COMMAND, STATUS, timedRunPacket} from '../game/ble.mjs';
const value = n => new DataView(Uint8Array.of(n).buffer);
const delay = n => new Promise(resolve => setTimeout(resolve, n));
function fixture({ack = true} = {}) {
  const status = new EventTarget();
  status.value = value(0);
  status.readValue = async () => status.value;
  status.startNotifications = async () => status;
  status.notify = n => { status.value = value(n); status.dispatchEvent(new Event('characteristicvaluechanged')); };
  const writes = [];
  const packets = [];
  const command = {writeValueWithResponse: async bytes => {
    writes.push(bytes[0]);
    packets.push(Array.from(bytes));
    if (ack && (bytes[0] === 0 || bytes[0] === 4)) status.notify(bytes[0] === 4 ? 1 : 0);
  }};
  const device = new EventTarget();
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    async getPrimaryService(uuid) {
      assert.equal(uuid, SERVICE);
      return {getCharacteristic: async id => id === COMMAND ? command : id === STATUS ? status : null};
    }
  };
  const bluetooth = {requestDevice: async options => {
    assert.deepEqual(options, {filters: [{services: [SERVICE]}]});
    return device;
  }};
  return {link: new PumpLink(bluetooth), status, command, device, writes, packets};
}
test('connect confirms stopped without running, and reconnect never runs', async () => {
  const f = fixture();
  await f.link.connect();
  assert.equal(f.link.phase, 'idle');
  assert.deepEqual(f.writes, [0]);
  await f.link.disconnect();
  await f.link.connect();
  assert.equal(f.link.phase, 'idle');
  assert.ok(f.writes.every(n => n === 0));
  f.link.drop('done');
});
test('repeated run taps cannot enqueue extra tests; Arduino state controls UI', async () => {
  const f = fixture();
  await f.link.connect();
  await Promise.all([f.link.run(), f.link.run(), f.link.run()]);
  assert.equal(f.link.phase, 'running');
  assert.equal(f.writes.filter(n => n === 4).length, 1);
  f.status.notify(0);
  assert.equal(f.link.phase, 'idle');
  assert.equal(f.link.heartbeat, null);
  f.link.drop('done');
});
test('Stop cancels a start that has not been sent yet', async () => {
  const f = fixture();
  await f.link.connect();
  await Promise.all([f.link.run(), f.link.stop()]);
  assert.equal(f.link.phase, 'idle');
  assert.equal(f.writes.includes(4), false);
  f.link.drop('done');
});
test('Stop follows an in-flight start and verifies stopped state', async () => {
  const f = fixture();
  await f.link.connect();
  let release;
  f.command.writeValueWithResponse = async bytes => {
    f.writes.push(bytes[0]);
    if (bytes[0] === 4) await new Promise(resolve => { release = resolve; });
    f.status.notify(bytes[0] === 4 ? 1 : 0);
  };
  const start = f.link.run();
  await delay(0);
  const stop = f.link.stop();
  release();
  await Promise.all([start, stop]);
  assert.equal(f.link.phase, 'idle');
  assert.deepEqual(f.writes.slice(-2), [4, 0]);
  f.link.drop('done');
});
test('disconnect disables controls and stops heartbeat', async () => {
  const f = fixture();
  await f.link.connect(); await f.link.run();
  f.device.gatt.disconnect();
  assert.equal(f.link.phase, 'offline');
  assert.equal(f.link.heartbeat, null);
  const sent = f.writes.length;
  await f.link.run();
  assert.equal(f.writes.length, sent);
});
test('missing start acknowledgement disconnects instead of claiming running', async () => {
  const f = fixture({ack:false});
  await f.link.connect(); await f.link.run();
  assert.equal(f.link.phase, 'idle');
  assert.equal(f.link.pending, 'run');
  await delay(1650);
  assert.equal(f.link.phase, 'offline');
  assert.match(f.link.message, /No start confirmation/);
});
test('Bluetooth chooser cancellation is recoverable', async () => {
  const link = new PumpLink({requestDevice: async () => { throw new DOMException('Cancelled','NotFoundError'); }});
  await link.connect();
  assert.equal(link.phase, 'offline');
  assert.match(link.message, /No pump selected/);
});
test('late completion after page closes cannot retain a connection', async () => {
  const f = fixture(); let release;
  f.device.gatt.connect = async function() { await new Promise(r => { release = r; }); this.connected = true; return this; };
  const connecting = f.link.connect();
  await delay(0);
  f.link.drop('page closed'); release(); await connecting;
  assert.equal(f.device.gatt.connected, false);
  assert.equal(f.link.phase, 'offline');
});

test('duration packets use milliseconds and preserve the 0.1–60 second limits', () => {
  for (const seconds of [.1, .5, 2, 10.5, 30, 60]) {
    const packet = timedRunPacket(seconds);
    assert.equal(packet[0], 4);
    assert.equal(packet.byteLength, 5);
    assert.equal(new DataView(packet.buffer).getUint32(1, true), seconds * 1000);
  }
  for (const seconds of [0, .09, 60.01, -1, NaN, Infinity, '2']) assert.throws(() => timedRunPacket(seconds), RangeError);
});
test('selected duration travels in the same write as Run; no default two-second command', async () => {
  const f = fixture(); await f.link.connect(); await f.link.run(30);
  assert.equal(f.link.runDurationMs, 30000);
  assert.deepEqual(f.packets.at(-1), [4, 48, 117, 0, 0]);
  assert.equal(f.link.phase, 'running');
  assert.equal(f.writes.includes(1), false);
  f.link.drop('done');
});
test('invalid duration cannot energize the motor', async () => {
  const f = fixture(); await f.link.connect();
  await f.link.run(0); await f.link.run(61); await f.link.run(NaN);
  assert.deepEqual(f.writes, [0]);
  assert.equal(f.link.phase, 'idle'); assert.equal(f.link.pending, '');
  f.link.drop('done');
});
