#pragma once
#include <stdint.h>
#include "PumpControl.h"

// Active-low, normally-open contact. Booting with the button held is not a press.
struct ButtonControl {
  static constexpr uint32_t debounceMs = 35;
  bool raw = false, stable = false, armed = false, inhibited = false;
  uint32_t changedAt = 0;
  void begin(bool pressed, uint32_t now) {
    raw = stable = pressed; armed = false; inhibited = false; changedAt = now;
  }
  bool update(bool pressed, uint32_t now, bool blocked = false) {
    if (pressed && blocked) inhibited = true;
    if (pressed != raw) { raw = pressed; changedAt = now; }
    if ((uint32_t)(now - changedAt) < debounceMs) return false;
    if (!raw) { stable = false; armed = true; inhibited = false; return false; }
    if (stable) return false;
    stable = true;
    const bool fire = armed && !inhibited;
    armed = false;
    return fire;
  }
};

inline bool validButtonDuration(uint32_t ms) {
  return ms == 0 || (ms >= PumpControl::minDurationMs && ms <= PumpControl::maxDurationMs);
}

// An interrupted EEPROM write fails validation; it never becomes a new dose.
struct ButtonSettings {
  uint32_t magic, durationMs, checksum;
  static constexpr uint32_t signature = 0x45504203;
  static uint32_t crc(uint32_t duration) {
    uint32_t result = 0xffffffffU;
    const uint32_t words[] = {signature, duration};
    for (auto word : words) for (int byte = 0; byte < 4; ++byte) {
      result ^= (word >> (byte * 8)) & 255;
      for (int bit = 0; bit < 8; ++bit)
        result = (result >> 1) ^ (0xedb88320U & (0U - (result & 1U)));
    }
    return ~result;
  }
  static ButtonSettings make(uint32_t duration) { return {signature, duration, crc(duration)}; }
  bool valid() const {
    return magic == signature && validButtonDuration(durationMs) && checksum == crc(durationMs);
  }
};
