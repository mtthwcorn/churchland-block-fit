// =============================================================================
// config.js — TASK SETTINGS
// -----------------------------------------------------------------------------
// This is the file you will edit most often. Every number that controls the
// task lives here, so you never have to dig through the task logic to change
// a timing or a size.
//
// All sizes are in CSS pixels (the browser's "logical" pixels, not physical
// screen pixels). The session record also saves window.devicePixelRatio, so
// you can convert to physical pixels later if you need to.
//
// All times are in milliseconds (ms).
//
// IMPORTANT: after you change ANY file, also bump CACHE_VERSION in sw.js,
// or the tablet will keep running the old cached copy. (See README.)
// =============================================================================

const CONFIG = {
  // Shown on the start screen and saved with every session, so you always
  // know which version of the task produced a given data file.
  // Keep this in step with CACHE_VERSION in sw.js.
  appVersion: '0.3.2',

  // ---------------- Which task ----------------
  // Chosen on the start screen; this is only the choice used the very first
  // time. The choice is remembered on the tablet and saved with each session.
  //   'anywhere' — the whole screen turns green; ANY touch on it gives juice
  //   'dot'      — touch the dot for juice (touches elsewhere are misses)
  defaultTaskMode: 'anywhere',

  // ---------------- Touch-anywhere task ----------------
  anywhereColor: '#00a651',     // screen color when a touch will be rewarded

  // true  = the screen stays green continuously, including while juice is
  //         being delivered (it only goes black if the task stops itself).
  // false = the screen goes black (backgroundColor) during the juice and the
  //         cooldown below, as a cue that green = touch now.
  anywhereStayGreen: true,

  // Extra wait after each juice delivery before the next touch is rewarded,
  // drawn uniformly between the two values. [0, 0] = no wait: the next touch
  // is rewarded as soon as the pump has stopped.
  // Touches while juice is still flowing are counted (itiTouchesBefore) but
  // not rewarded, because the pump runs one reward at a time with no queue.
  anywhereCooldownMs: [0, 0],
  // If true, touching during the cooldown restarts it.
  anywhereTouchRestartsCooldown: false,
  // The green screen waits as long as needed: there is no timeout in this task.
  // (Note: the two invisible 100 px corner zones for the experimenter panel
  // stay active, so touches in the very top-left/top-right corners do not
  // give juice.)

  // ---------------- Dot (the touch target, dot task only) ----------------
  dotRadiusPx: 60,          // radius of the visible dot
  hitTolerancePx: 25,       // extra "forgiveness" around the dot: a touch counts
                            // as a hit if it lands within dotRadius + tolerance
  dotColor: '#ffffff',
  backgroundColor: '#000000',

  // Where the dot appears:
  //   'center' — always the middle of the screen (good for very early training)
  //   'random' — anywhere on screen, keeping away from the edges
  dotPosition: 'random',

  // Keep dots at least this far from every screen edge. This also keeps them
  // clear of the invisible corner zones used to open the experimenter panel
  // (those zones are 100 px squares, so keep this bigger than 100 + dotRadius).
  edgeMarginPx: 180,

  // ---------------- Trial timing ----------------
  responseWindowMs: 5000,   // how long the dot stays up before a "timeout"
  itiMs: [1000, 2000],      // inter-trial interval, drawn uniformly between
                            // these two values (min, max)
  errorPenaltyMs: 1500,     // extra delay added after a miss or a timeout

  // If true, touching the screen during the inter-trial interval restarts the
  // interval (a common contingency to discourage constant tapping).
  // Touches during the interval are counted either way (itiTouchesBefore).
  itiTouchRestartsDelay: false,

  // ---------------- Juice reward ----------------
  // The pump protocol (Bluetooth commands, the fixed 90 mL/min pump rate, and
  // the 0.15–90 mL limits) comes unchanged from the lab's Block Fit game, in
  // ble.mjs and rewards.mjs. The amount per hit is typed into the
  // experimenter panel and remembered on the tablet; this is only the value
  // used the very first time, before anything has been typed.
  defaultRewardMl: 0.3,

  // ---------------- Manual juice from buttons ----------------
  // Pressing any of these keys gives one manual reward (the current mL per
  // hit), at any time while the pump is connected, during a session or not.
  // Manual rewards are logged as events and never interrupt a trial reward:
  // if one is already running, the press is ignored and logged as skipped.
  //
  // Volume buttons: some Android browsers never pass these to web pages (the
  // tablet just changes its volume). Check yours: open the experimenter panel
  // and press a volume button; "Last key pressed" shows whether the page saw it.
  //
  // Reliable alternative: a Bluetooth presentation remote or page turner
  // sends keys like PageDown/PageUp or ArrowRight/ArrowLeft, which Chrome
  // always passes on. Add them below, e.g. 'PageDown', 'PageUp'.
  // (Key names are shown under "Last key pressed" in the panel.)
  manualRewardKeys: ['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown'],
  manualRewardKeyCodes: [174, 175, 182, 183], // older numeric codes for volume keys

  // ---------------- Reward tone ----------------
  // A short tone plays on every hit, in both juice and practice sessions. It is generated by the browser itself,
  // so no sound file is needed and it works offline.
  rewardToneHz: 1200,
  rewardToneMs: 150,
  rewardToneVolume: 0.3,    // 0 to 1

  // ---------------- Experimenter panel ----------------
  // The panel opens when you tap the invisible corners in this order:
  //   top-left, top-right, top-left — all within this many ms.
  adminTapWindowMs: 3000,
};
