import {PumpLink, SERVICE} from '../game/ble.mjs';

export const SETTINGS = '3e61a103-27c5-4b4a-a89d-72b7b1478420';
export const FLOW_ML_PER_MINUTE = 90;
export function doseMilliseconds(ml) {
  if (typeof ml !== 'number' || !Number.isFinite(ml) || ml < .15 || ml > 90)
    throw new RangeError('Enter 0.15–90 mL per press.');
  return Math.round(ml / (FLOW_ML_PER_MINUTE / 60) * 1000);
}
export function doseVolume(ms) { return ms / 1000 * (FLOW_ML_PER_MINUTE / 60); }
export function settingsPacket(ms) {
  if (!Number.isInteger(ms) || (ms !== 0 && (ms < 100 || ms > 60000)))
    throw new RangeError('Invalid button duration.');
  const packet = new Uint8Array(5);
  packet[0] = 5;
  new DataView(packet.buffer).setUint32(1, ms, true);
  return packet;
}
export function readSettings(value) {
  if (!value || value.byteLength !== 5 || value.getUint8(0) !== 1)
    throw new Error('Unsupported button settings. Update the Arduino firmware.');
  const ms = value.getUint32(1, true);
  settingsPacket(ms); // Check device replies with the same limits as writes.
  return ms;
}

export class ButtonPumpLink extends PumpLink {
  constructor(bluetooth) {
    super(bluetooth);
    this.buttonMs = null;
    this.loadingSettings = false;
    this.savingSettings = false;
  }
  async connect() {
    if (this.phase !== 'offline') return;
    this.loadingSettings = true;
    const epoch = this.epoch + 1;
    await super.connect();
    if (epoch !== this.epoch || !this.device?.gatt.connected) return;
    try {
      const characteristic = await this.enqueue(async () => {
        const service = await this.device.gatt.getPrimaryService(SERVICE);
        return service.getCharacteristic(SETTINGS);
      });
      if (epoch !== this.epoch) return;
      this.settings = characteristic;
      const value = await this.enqueue(() => characteristic.readValue());
      if (epoch !== this.epoch) return;
      this.buttonMs = readSettings(value);
      this.message = this.buttonMs ? '' : 'Choose a dose in Settings, then save to Arduino.';
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.buttonMs = null;
      this.message = error.name === 'NotFoundError'
        ? 'Upload the button firmware to your Arduino first. See Settings.'
        : this.friendly(error);
    } finally {
      if (epoch === this.epoch) { this.loadingSettings = false; this.emit(); }
    }
  }
  async saveDose(ml, enabled = true) {
    if (this.phase !== 'idle' || this.pending || this.loadingSettings || this.savingSettings || this.buttonMs === null)
      return false;
    const ms = enabled ? doseMilliseconds(ml) : 0;
    const packet = settingsPacket(ms);
    const epoch = this.epoch;
    this.savingSettings = true;
    this.message = '';
    this.emit();
    try {
      await this.write(packet);
      const value = await this.enqueue(() => this.settings.readValue());
      if (epoch !== this.epoch) return false;
      this.buttonMs = readSettings(value);
      if (this.buttonMs !== ms) {
        this.message = 'Setting was not accepted. Wait until the pump stops, then save again.';
        return false;
      }
      this.message = ms ? 'Saved to Arduino.' : 'Button disabled on Arduino.';
      return true;
    } catch (error) {
      if (epoch === this.epoch) this.drop('Could not confirm the saved dose. Reconnect to read it from Arduino.');
      return false;
    } finally {
      if (epoch === this.epoch) { this.savingSettings = false; this.emit(); }
    }
  }
  async give() {
    if (this.loadingSettings || this.savingSettings || !this.buttonMs) return;
    await super.run(this.buttonMs / 1000);
  }
  drop(message) {
    this.settings = null;
    this.buttonMs = null;
    this.loadingSettings = this.savingSettings = false;
    super.drop(message);
  }
}
