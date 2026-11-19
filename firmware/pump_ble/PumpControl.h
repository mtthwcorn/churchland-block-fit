#pragma once
#include <stdint.h>

// The board owns the time limit, even if the browser freezes or disappears.
struct PumpControl {
  static constexpr uint32_t minDurationMs = 100;
  static constexpr uint32_t maxDurationMs = 60000;
  static constexpr uint32_t leaseMs = 1000;
  uint32_t durationMs = 2000;
  bool running = false;
  bool wireless = false;
  uint32_t started = 0;
  uint32_t lastHeartbeat = 0;

  bool start(uint32_t now, bool fromBluetooth, uint32_t requestedMs = 2000) {
    if (running || requestedMs < minDurationMs || requestedMs > maxDurationMs) return false;
    durationMs = requestedMs; // Repeated commands cannot extend an active run.
    running = true;
    wireless = fromBluetooth;
    started = lastHeartbeat = now;
    return true;
  }
  void heartbeat(uint32_t now) {
    if (running && wireless) lastHeartbeat = now;
  }
  bool expired(uint32_t now) const {
    return running && ((uint32_t)(now - started) >= durationMs ||
      (wireless && (uint32_t)(now - lastHeartbeat) >= leaseMs));
  }
  void stop() { running = false; wireless = false; }
};
