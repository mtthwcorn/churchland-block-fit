# Physical juice button — Eric Pump v3

## Wiring

For a **normally-open, momentary, two-wire contact button**, connect either wire
to **D2** and the other to **GND** on the UNO R4 WiFi / fitted screw-terminal shield.
Polarity does not matter. The sketch enables `INPUT_PULLUP`: released is HIGH,
pressed connects D2 to ground and reads LOW. Do not connect the button to 5V or 9V.
An illuminated, powered, or latching switch is not equivalent to this contact button.

Existing TB6612FNG wiring stays: PWMA D5, AIN2 D6, AIN1 D7, STBY D8,
VCC Arduino 5V, shared GND, VM battery 9V, motor on AO1/AO2.
Power the UNO from regulated 5V through USB-C, or its correctly rated DC input;
the round barrel jack is not a 5V input.

## Upload once

1. Switch off the motor's 9V supply during upload; connect the UNO to the Mac with a USB data cable.
2. Open `pump_ble/pump_ble.ino` in Arduino IDE. Keep both `.h` files beside it.
3. Install **Arduino UNO R4 Boards** in Boards Manager and **ArduinoBLE** in Library Manager.
4. Select **Arduino UNO R4 WiFi** and its USB port, then click **Upload**.
5. Re-enable the motor supply. In Android Chrome, open
   <https://churchland-block-fit.vercel.app/pump/#settings>, connect to **Eric Pump**,
   enable the button, choose **mL per press**, and **Save to Arduino**.
6. After the page confirms the save, press and release the physical button once.

No Arduino was connected during development; the checked-in firmware must be uploaded
before the physical button works. Old firmware is detected by the settings page.
If upgrading an existing Bluetooth pairing, disconnect and power-cycle the board
after upload so Chrome can discover its new settings characteristic.

## Dose and behavior

- Conversion retained from this project: **90 mL/min = 1.5 mL/s**.
  `duration_ms = round(mL / 1.5 × 1000)`.
- 0.3 mL = 0.2 seconds; 1.5 mL = 1 second; 3 mL = 2 seconds.
- This is an **estimate**, not measured delivery. The 12V-rated pump is being used
  at 9V; tubing, fluid, pressure and supply affect actual flow. To verify, prime the
  tubing, collect several timed doses, and measure their combined volume.
- Limits: 0.15–90 mL (100–60000 ms). Millisecond rounding is reflected in the saved display.
- First boot / invalid saved data: the physical button is disabled until a dose is saved.
- Settings are checked and stored in EEPROM only on a changed save; no save occurs on connect.
- One press triggers one complete timed dose. A held button never repeats; release
  and press again for another dose. A button held at boot must be released first.
- Presses during a dose or while disabled are discarded; there is no reward queue.
- The physical button works without a browser, USB data connection, or BLE initialization.
  It still needs the UNO and motor supplies powered.
- Browser pulses retain the one-second missing-heartbeat stop. Physical pulses use
  the board's hard duration limit. Stop cancels either type. BLE connection/disconnection
  stops any current pulse; it never resumes. A subsequent physical press still works.
- The existing Block Fit and touch-task protocols remain compatible. Their reward
  settings are separate from the saved physical-button dose.

## BLE protocol

Service `3e61a100-27c5-4b4a-a89d-72b7b1478420`; device name `Eric Pump`.

| Characteristic | Access | Value |
| --- | --- | --- |
| `…a101…` | Write with response | Commands below |
| `…a102…` | Read / notify | `0` stopped, `1` running (output state, not flow measurement) |
| `…a103…` | Read / notify | `1` protocol version, then uint32 LE saved button duration in ms; 0 disables |

Existing commands: `[0]` stop, `[1]` legacy two-second pulse, `[2]` heartbeat,
`[3]` status, `[4, duration uint32 LE]` browser pulse.
New command: `[5, duration uint32 LE]` saves button duration; 0 disables.
Changes are rejected during a pulse or for invalid durations. Read `…a103…`
after writing and compare before showing success. Malformed commands stop the pump.
The UI reads the device setting on every connection and never replays an old browser value.

## Verification

`npm run test:firmware` checks debounce, held buttons, busy presses, corruption,
timer rollover, duration limits, and heartbeat stops using the same C++ control code.

Compile for hardware with:

```sh
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi firmware/pump_ble
```

Hardware flow and button wiring still need a physical check after upload.
