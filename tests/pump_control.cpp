#include "../firmware/pump_ble/PumpControl.h"
#include "../firmware/pump_ble/ButtonControl.h"
#include <cassert>
#include <cstdio>
#include <initializer_list>
int main() {
  PumpControl p;
  assert(!p.running && !p.expired(0));
  assert(p.start(100, true));
  assert(!p.start(500, true));
  assert(!p.expired(1099) && p.expired(1100)); // Lost browser heartbeat.
  p.heartbeat(900);
  assert(!p.expired(1500));
  p.heartbeat(1800);
  assert(!p.expired(2099) && p.expired(2100)); // Hard limit still wins.
  p.stop();
  assert(!p.running);
  p.heartbeat(2200);
  assert(!p.running); // Heartbeat never starts the motor.
  assert(p.start(0xfffffff0U, true));
  assert(p.expired(0x3d8U)); // Lease works across millis() rollover.
  p.stop();
  assert(p.start(0xfffffff0U, false));
  assert(!p.expired(0x3d8U) && p.expired(0x7c0U));
  p.stop();
  assert(!p.start(0, true, 0));
  assert(!p.start(0, true, 99));
  assert(!p.start(0, true, 60001));
  assert(!p.start(0, true, 0xffffffffU));
  assert(!p.running);
  assert(p.start(0, true, 100));
  assert(!p.expired(99) && p.expired(100));
  p.stop();
  assert(p.start(100, true, 10000));
  for (uint32_t now = 600; now < 10100; now += 500) {
    p.heartbeat(now);
    assert(!p.expired(now));
  }
  assert(!p.start(10099, true, 60000));
  assert(p.expired(10100));
  p.stop();
  assert(p.start(0xfffffff0U, false, 60000));
  assert(!p.expired(59983U) && p.expired(59984U));
  p.stop();
  ButtonControl b;
  b.begin(true, 0);
  assert(!b.update(true, 10000)); // Held at boot never dispenses.
  assert(!b.update(false, 10001));
  assert(!b.update(false, 10036)); // Stable release arms it.
  assert(!b.update(true, 10040));
  assert(!b.update(false, 10045));
  assert(!b.update(true, 10050));
  assert(!b.update(true, 10084));
  assert(b.update(true, 10085)); // Bounce yields exactly one press.
  assert(p.start(10085, false, 200));
  assert(!b.update(true, 20000)); // Holding does not repeat, even beyond dose end.
  p.stop();
  assert(!b.update(true, 30000));
  assert(!b.update(false, 30001)); assert(!b.update(false, 30036));
  assert(p.start(30040, true, 2000));
  assert(!b.update(true, 30045));
  assert(b.update(true, 30080));
  assert(!p.start(30080, false, 200)); // Press while busy is consumed, not queued.
  p.stop();
  assert(!b.update(true, 33000));
  b.begin(false, 0xfffffff0U);
  assert(!b.update(false, 20));
  assert(!b.update(true, 30));
  assert(b.update(true, 65)); // Debounce rollover.
  b.begin(false, 0);
  assert(!b.update(false, 35));
  assert(!b.update(true, 50, true)); // Press begins while busy/disabled.
  assert(!b.update(true, 100, false)); // Becoming idle during debounce cannot queue it.
  assert(!b.update(false, 150)); assert(!b.update(false, 185));
  assert(!b.update(true, 200)); assert(b.update(true, 235));
  for (uint32_t ms : {0U,100U,200U,60000U}) {
    auto saved = ButtonSettings::make(ms);
    assert(saved.valid());
    for (unsigned bit=0;bit<32;bit++) {
      auto corrupt = saved; corrupt.durationMs ^= 1U << bit; assert(!corrupt.valid());
      corrupt = saved; corrupt.checksum ^= 1U << bit; assert(!corrupt.valid());
      corrupt = saved; corrupt.magic ^= 1U << bit; assert(!corrupt.valid());
    }
  }
  ButtonSettings erased = {0xffffffffU,0xffffffffU,0xffffffffU};
  assert(!erased.valid());
  assert(!ButtonSettings::make(99).valid());
  assert(!ButtonSettings::make(60001).valid());
  puts("PASS: debouncing, hold/release, startup, busy press, settings validation and corruption");
  puts("PASS: limits, selected duration, duplicate commands, lease, stop, timer rollover, USB compatibility");
}
