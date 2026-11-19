#include <ArduinoBLE.h>
#include <EEPROM.h>
#include "PumpControl.h"
#include "ButtonControl.h"

// UNO R4 WiFi + TB6612FNG channel A. Existing motor connections are unchanged.
// Normally-open momentary button: D2 <-> button <-> GND (no external voltage).
constexpr int PWM_PIN = 5, DIR2_PIN = 6, DIR1_PIN = 7, STANDBY_PIN = 8, BUTTON_PIN = 2;
BLEService pumpService("3e61a100-27c5-4b4a-a89d-72b7b1478420");
BLECharacteristic commandCharacteristic("3e61a101-27c5-4b4a-a89d-72b7b1478420", BLEWrite, 5);
BLEByteCharacteristic stateCharacteristic("3e61a102-27c5-4b4a-a89d-72b7b1478420", BLERead | BLENotify);
// Version 1 + uint32 little-endian saved button duration; zero means disabled.
BLECharacteristic settingsCharacteristic("3e61a103-27c5-4b4a-a89d-72b7b1478420", BLERead | BLENotify, 5, true);
PumpControl pump;
ButtonControl button;
uint32_t buttonDurationMs = 0;
bool bleReady = false, centralConnected = false;

void publishState() { if (bleReady) stateCharacteristic.writeValue(pump.running ? 1 : 0); }
void publishSettings() {
  if (!bleReady) return;
  uint8_t bytes[5] = {1, (uint8_t)buttonDurationMs, (uint8_t)(buttonDurationMs >> 8),
    (uint8_t)(buttonDurationMs >> 16), (uint8_t)(buttonDurationMs >> 24)};
  settingsCharacteristic.writeValue(bytes, 5);
}
void saveSettings(uint32_t duration) {
  if (!pump.running && validButtonDuration(duration) && duration != buttonDurationMs) {
    ButtonSettings record = ButtonSettings::make(duration);
    EEPROM.put(0, record);
    ButtonSettings verified;
    EEPROM.get(0, verified);
    buttonDurationMs = verified.valid() && verified.durationMs == duration ? duration : 0;
  }
  publishSettings(); // Browser reads back the accepted value, including on rejection.
}
void stopPump() {
  digitalWrite(STANDBY_PIN, LOW);
  digitalWrite(PWM_PIN, LOW);
  pump.stop();
  publishState();
}
void startPump(bool wireless, uint32_t durationMs = 2000) {
  if (!pump.start(millis(), wireless, durationMs)) return;
  digitalWrite(DIR1_PIN, HIGH);
  digitalWrite(DIR2_PIN, LOW);
  digitalWrite(PWM_PIN, HIGH);
  digitalWrite(STANDBY_PIN, HIGH);
  publishState();
}
void onConnect(BLEDevice central) { centralConnected = true; stopPump(); }
void onDisconnect(BLEDevice central) { centralConnected = false; stopPump(); }
void onCommand(BLEDevice central, BLECharacteristic characteristic) {
  const uint8_t* bytes = commandCharacteristic.value();
  const int length = commandCharacteristic.valueLength();
  if (length == 5 && (bytes[0] == 4 || bytes[0] == 5)) {
    uint32_t duration = (uint32_t)bytes[1] | ((uint32_t)bytes[2] << 8) |
      ((uint32_t)bytes[3] << 16) | ((uint32_t)bytes[4] << 24);
    if (bytes[0] == 5) {
      if (centralConnected) saveSettings(duration);
    } else if (duration < PumpControl::minDurationMs || duration > PumpControl::maxDurationMs) {
      stopPump();
    } else if (centralConnected) startPump(true, duration);
    return;
  }
  if (length != 1) { stopPump(); return; }
  switch (bytes[0]) {
    case 0: stopPump(); break;
    case 1: if (centralConnected) startPump(true); break;
    case 2: pump.heartbeat(millis()); break;
    case 3: publishState(); break;
    default: stopPump(); break;
  }
}
void setup() {
  digitalWrite(STANDBY_PIN, LOW);
  digitalWrite(PWM_PIN, LOW);
  pinMode(STANDBY_PIN, OUTPUT);
  pinMode(PWM_PIN, OUTPUT);
  pinMode(DIR1_PIN, OUTPUT);
  pinMode(DIR2_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  button.begin(digitalRead(BUTTON_PIN) == LOW, millis());
  ButtonSettings saved;
  EEPROM.get(0, saved);
  buttonDurationMs = saved.valid() ? saved.durationMs : 0;
  Serial.begin(9600); // Do not wait for USB; standalone battery operation is supported.
  if (!BLE.begin()) {
    Serial.println("Bluetooth unavailable; physical button uses saved setting.");
    return;
  }
  BLE.setLocalName("Eric Pump");
  BLE.setDeviceName("Eric Pump");
  BLE.setAdvertisedService(pumpService);
  pumpService.addCharacteristic(commandCharacteristic);
  pumpService.addCharacteristic(stateCharacteristic);
  pumpService.addCharacteristic(settingsCharacteristic);
  BLE.addService(pumpService);
  BLE.setEventHandler(BLEConnected, onConnect);
  BLE.setEventHandler(BLEDisconnected, onDisconnect);
  commandCharacteristic.setEventHandler(BLEWritten, onCommand);
  bleReady = true;
  publishState();
  publishSettings();
  BLE.advertise();
  Serial.println("Eric Pump v3: D2 button, saved dose, BLE ready. Motor stopped.");
}
void loop() {
  if (pump.expired(millis())) stopPump();
  if (bleReady) BLE.poll();
  if (pump.expired(millis())) stopPump();
  // Consume every press, even when busy/disabled: never queue or repeat doses.
  if (button.update(digitalRead(BUTTON_PIN) == LOW, millis(), pump.running || !buttonDurationMs) && buttonDurationMs && !pump.running)
    startPump(false, buttonDurationMs);
  if (Serial.available()) {
    char command = Serial.read();
    if (command == 's' || command == 'S') stopPump();
    if ((command == 't' || command == 'T') && !centralConnected) startPump(false);
    if (command == '?') {
      Serial.print("Eric Pump v3 | BUTTON ms: "); Serial.print(buttonDurationMs);
      Serial.println(pump.running ? " | RUNNING" : " | STOPPED");
    }
  }
}
