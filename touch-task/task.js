// =============================================================================
// task.js: THE TASK ITSELF, THE JUICE PUMP, THE CLOCKS, AND THE PANEL
// -----------------------------------------------------------------------------
// Overview of one session:
//
//   Start screen  --(experimenter picks a task and taps Start)-->  trials repeat.
//
//   DOT task:
//     [ITI: blank screen] -> [dot appears] -> hit     -> tone + juice -> ITI
//                                          -> miss    -> penalty ITI
//                                          -> timeout -> penalty ITI
//
//   TOUCH-ANYWHERE task (first training step):
//     [whole screen green] -> any touch = hit -> tone + juice -> (optional
//     cooldown) -> next touch rewarded. By default the screen stays green the
//     whole time (CONFIG.anywhereStayGreen). It waits indefinitely: no
//     timeout, no misses.
//
//   Tap the hidden corners (top-left, top-right, top-left) to pause and open
//   the experimenter panel: pump, export data, check the clock, resume, end.
//
// JUICE (same protocol as the lab's Block Fit game):
//   The tablet talks to the Arduino pump directly over Bluetooth, using
//   ble.mjs and rewards.mjs copied unchanged from Block Fit. On each hit, the
//   mL typed in the panel is turned into a pump run time at the fixed
//   90 mL/min rate and sent as ONE timed command. The next trial waits until
//   the Arduino reports the pump has stopped; rewards never queue up.
//
//   Safety rules, also matching Block Fit:
//   - Connecting never starts the motor.
//   - If a reward can't be delivered (pump lost, stopped early, bad amount),
//     the task STOPS on a black screen and waits for the experimenter. It never
//     keeps running trials without juice, and a missed reward is never replayed.
//   - Opening the panel, or the app going to the background, stops the pump.
//   - The Arduino also stops by itself if the tablet's heartbeat goes quiet.
//
// ABOUT THE TWO CLOCKS (why every record has both):
//
//   Date.now()        "wall clock": milliseconds since 1 Jan 1970 (UTC).
//                     Tells you WHEN something happened in real-world time.
//                     But with no network, nothing corrects it, so it can
//                     drift; and Android may adjust it, making it jump.
//
//   performance.now() "monotonic clock": milliseconds since this page was
//                     opened, with sub-millisecond resolution. It never
//                     jumps, so it is the right clock for reaction times
//                     and intervals. But on its own it doesn't say what
//                     time of day it is.
//
//   Touch events (event.timeStamp) and animation frames (requestAnimationFrame)
//   are reported on the performance.now() clock, so they line up exactly.
//
//   Each trial saves a pair (trialStartWallMs, trialStartPerfMs) read back to
//   back, plus their difference wallMinusPerfMs. Within a session that
//   difference should stay constant. If it changes, the wall clock was
//   adjusted or drifted relative to the monotonic clock, and you can see
//   exactly at which trial. To convert any perf time to wall time, use the
//   pair from the same trial:   wall = perf + wallMinusPerfMs
//
//   The clock checks (in the panel) then compare the tablet's wall clock to
//   an outside reference, so you can correct for the tablet clock being off.
//
// CONFIG, dbPut, exportAllData, etc. come from config.js and storage.js,
// which are loaded before this file (see index.html).
// =============================================================================

import { PumpLink } from './ble.mjs';
import { PUMP_ML_PER_MINUTE, rewardPlan, PulseRunner } from './rewards.mjs';

// ---------- Grab the page elements we need (defined in index.html) ----------
const $ = (id) => document.getElementById(id);
const els = {
  startScreen: $('start-screen'),
  subjectInput: $('subject-input'),
  taskMode: $('task-mode'),
  startJuiceBtn: $('start-juice-btn'),
  startPracticeBtn: $('start-practice-btn'),
  startMsg: $('start-msg'),
  startStatus: $('start-status'),
  startAdminBtn: $('start-admin-btn'),
  arena: $('arena'),
  dot: $('dot'),
  haltMsg: $('halt-msg'),
  cornerTL: $('corner-tl'),
  cornerTR: $('corner-tr'),
  admin: $('admin'),
  adminStatus: $('admin-status'),
  adminMsg: $('admin-msg'),
  exportBtn: $('export-btn'),
  clearBtn: $('clear-btn'),
  tabletClock: $('tablet-clock'),
  refTimeInput: $('ref-time-input'),
  manualClockBtn: $('manual-clock-btn'),
  onlineClockBtn: $('online-clock-btn'),
  clockMsg: $('clock-msg'),
  resumeBtn: $('resume-btn'),
  endBtn: $('end-btn'),
  closeAdminBtn: $('close-admin-btn'),
  version: $('version'),
  // pump controls
  pumpBox: $('pump-box'),
  pumpSlotStart: $('pump-slot-start'),
  pumpSlotAdmin: $('pump-slot-admin'),
  connectBtn: $('connect-btn'),
  disconnectBtn: $('disconnect-btn'),
  pumpLabel: $('pump-label'),
  rewardMl: $('reward-ml'),
  dosePreview: $('dose-preview'),
  giveRewardBtn: $('give-reward-btn'),
  stopPumpBtn: $('stop-pump-btn'),
  pumpNote: $('pump-note'),
};

// ---------- The pump ----------
// PumpLink handles the Bluetooth connection and commands; PulseRunner runs one
// timed pulse and only reports success once the Arduino confirms it started
// AND stopped after the full duration.
const link = new PumpLink();
const runner = new PulseRunner(link);
const REWARD_ML_KEY = 'nhp-touch-task-reward-ml';
const TASK_MODE_KEY = 'nhp-touch-task-mode';

// ---------- Task state ----------
let session = null;        // the current session record (null = no session)
let state = 'idle';        // 'idle' | 'iti' | 'dotOn' | 'reward' | 'paused'
let current = null;        // the trial currently on screen
let trialNum = 0;
let itiTimer = null;       // timer that ends the inter-trial interval
let responseTimer = null;  // timer that ends the response window (timeout)
let itiTouchCount = 0;     // touches between the end of one trial and the next dot
let runToken = 0;          // goes up on every pause; lets a finishing reward
                           // know if the task was paused while it ran
let counts = newCounts();
let audioCtx = null;       // for the reward tone
let wakeLock = null;       // keeps the screen from turning off
let clockTimer = null;     // updates the live clock in the panel
let lastPumpPhase = 'offline';

function newCounts() {
  return { hit: 0, miss: 0, timeout: 0, aborted: 0, rewardsDelivered: 0, rewardFailures: 0, saveErrors: 0 };
}

// "20261110T140322" style compact time for IDs
function compactIso(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15); }

// Record a timestamped event (pump connected, task paused, manual reward...).
function logEvent(type, detail) {
  const wall = Date.now();
  const rec = {
    type,
    detail: detail || '',
    wallMs: wall,
    perfMs: performance.now(),
    iso: new Date(wall).toISOString(),
    sessionId: session ? session.sessionId : null,
    trialNum: session ? trialNum : null,
    exported: 0,
  };
  dbPut('events', rec).catch((e) => { counts.saveErrors++; console.error('Event save failed', e); });
}

// =============================================================================
// STARTUP
// =============================================================================
// Module scripts run after the page has been parsed, so the elements exist.
(async function startup() {
  els.version.textContent = 'v' + CONFIG.appVersion;
  document.documentElement.style.setProperty('--bg', CONFIG.backgroundColor);
  els.dot.style.background = CONFIG.dotColor;

  // Remember the last subject name and reward size between sessions.
  try {
    els.subjectInput.value = localStorage.getItem('lastSubject') || '';
    const ml = localStorage.getItem(REWARD_ML_KEY);
    els.rewardMl.value = ml !== null ? ml : CONFIG.defaultRewardMl;
    els.taskMode.value = localStorage.getItem(TASK_MODE_KEY) || CONFIG.defaultTaskMode;
  } catch (e) { els.rewardMl.value = CONFIG.defaultRewardMl; els.taskMode.value = CONFIG.defaultTaskMode; }
  if (!els.taskMode.value) els.taskMode.value = 'anywhere';
  els.taskMode.addEventListener('change', () => {
    try { localStorage.setItem(TASK_MODE_KEY, els.taskMode.value); } catch (e) { /* ignore */ }
  });

  // Web Bluetooth only exists in Chrome (Android/desktop) on an https page.
  if (!window.isSecureContext || !navigator.bluetooth) {
    els.pumpNote.hidden = false;
    els.pumpNote.textContent = !window.isSecureContext
      ? 'Bluetooth needs the https:// address. Practice sessions still work here.'
      : 'This browser has no Bluetooth access. Use Chrome on the Android tablet. Practice sessions still work here.';
  }

  placePumpBox(els.pumpSlotStart);
  refreshPump();

  // Register the service worker: this is what makes the app work offline.
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (e) { console.error('Service worker registration failed', e); }
  }

  // Ask Android not to delete our stored data when space runs low.
  // Installed apps are usually granted this automatically.
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { /* ignore */ }
  }

  await openDB();
  refreshStartStatus();
})();

// Stop long-press menus, double-tap zoom, text selection, etc.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// If the app goes to the background (home button, notification, screen off),
// stop the pump and pause, like Block Fit. The experimenter resumes from the
// panel. With screen pinning on, this should not happen during a session.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (session && state !== 'paused') haltTask('The app went to the background.');
    else stopPumpQuietly();
  } else if (session) {
    requestWakeLock();
  }
});

// Closing the app: drop the Bluetooth link. The Arduino stops on disconnect.
window.addEventListener('pagehide', () => { runner.cancel?.(); link.drop('Page closed.'); });

// =============================================================================
// SESSION START / END
// =============================================================================
els.startJuiceBtn.addEventListener('click', () => startSession('juice'));
els.startPracticeBtn.addEventListener('click', () => startSession('practice'));

async function startSession(rewardMode) {
  const subject = els.subjectInput.value.trim();
  if (!subject) { els.startMsg.textContent = 'Enter a subject name first.'; return; }
  if (rewardMode === 'juice') {
    const problem = juiceProblem();
    if (problem) { els.startMsg.textContent = problem; return; }
  }
  try { localStorage.setItem('lastSubject', subject); } catch (e) { /* ignore */ }

  // These three must run right inside the tap (browsers require a user
  // gesture for fullscreen and for sound), so they come before any "await".
  enterFullscreen();
  unlockAudio();
  requestWakeLock();

  // The session "anchor": both clocks read back to back at the start.
  const wall = Date.now();
  const perf = performance.now();

  session = {
    sessionId: `${subject}_${compactIso(wall)}`,
    subject,
    appVersion: CONFIG.appVersion,
    taskMode: els.taskMode.value,       // 'anywhere' or 'dot'
    rewardMode,                         // 'juice' or 'practice'
    pumpName: rewardMode === 'juice' ? (link.device?.name || 'pump') : null,
    pumpMlPerMinute: PUMP_ML_PER_MINUTE,
    startWallMs: wall,
    startPerfMs: perf,
    startIso: new Date(wall).toISOString(),
    // performance.timeOrigin = the wall-clock time (ms) at which perf time 0
    // was. A second, independent anchor between the two clocks.
    perfTimeOrigin: performance.timeOrigin,
    timezoneOffsetMin: new Date(wall).getTimezoneOffset(),
    endWallMs: null,
    endPerfMs: null,
    endIso: null,
    nTrials: 0,
    counts: null,
    screenW: window.innerWidth,
    screenH: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    config: { ...CONFIG },   // a snapshot of every setting used
    exported: 0,
  };
  trialNum = 0;
  counts = newCounts();
  itiTouchCount = 0;

  await saveSession();
  logEvent('sessionStart', `${session.taskMode}, ${rewardMode}`);

  els.startMsg.textContent = '';
  els.haltMsg.hidden = true;
  els.startScreen.hidden = true;
  els.arena.hidden = false;
  els.cornerTL.hidden = false;
  els.cornerTR.hidden = false;

  scheduleNextTrial(0);
}

async function endSession() {
  if (!session) return;
  pauseTask();
  session.endWallMs = Date.now();
  session.endPerfMs = performance.now();
  session.endIso = new Date(session.endWallMs).toISOString();
  logEvent('sessionEnd');
  await saveSession();
  session = null;

  releaseWakeLock();
  exitFullscreen();
  closeAdmin();
  els.arena.hidden = true;
  els.cornerTL.hidden = true;
  els.cornerTR.hidden = true;
  els.startScreen.hidden = false;
  els.startMsg.textContent = 'Session ended and saved.';
  refreshStartStatus();
}

// Write the session record. Setting exported = 0 means "this record has
// changed since the last export", so it will be included again next time.
async function saveSession() {
  if (!session) return;
  session.nTrials = trialNum;
  session.counts = { ...counts };
  session.exported = 0;
  try { await dbPut('sessions', session); }
  catch (e) { counts.saveErrors++; console.error('Session save failed', e); }
}

// =============================================================================
// TRIAL LOOP
// =============================================================================

// Blank screen for a random interval, then show the dot.
function scheduleNextTrial(extraDelayMs) {
  clearTimeout(itiTimer);
  state = 'iti';
  setArenaColor(betweenTrialsColor());
  const [lo, hi] = session.taskMode === 'anywhere' ? CONFIG.anywhereCooldownMs : CONFIG.itiMs;
  const delay = lo + Math.random() * (hi - lo) + (extraDelayMs || 0);
  itiTimer = setTimeout(showDot, delay);
}

function pickDotPosition() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (CONFIG.dotPosition === 'center') return { x: w / 2, y: h / 2 };
  const m = Math.max(CONFIG.edgeMarginPx, CONFIG.dotRadiusPx);
  // If the screen is too small for the margin, fall back to the center.
  const x = w > 2 * m ? m + Math.random() * (w - 2 * m) : w / 2;
  const y = h > 2 * m ? m + Math.random() * (h - 2 * m) : h / 2;
  return { x, y };
}

function setArenaColor(color) { els.arena.style.background = color; }

// Screen color during juice delivery and the inter-trial interval/cooldown.
function betweenTrialsColor() {
  return session && session.taskMode === 'anywhere' && CONFIG.anywhereStayGreen
    ? CONFIG.anywhereColor : CONFIG.backgroundColor;
}

// Starts a trial: shows the dot (dot task) or turns the screen green
// (touch-anywhere task).
function showDot() {
  itiTimer = null;
  const anywhere = session.taskMode === 'anywhere';
  const { x, y } = anywhere ? { x: null, y: null } : pickDotPosition();
  const r = anywhere ? null : CONFIG.dotRadiusPx;
  trialNum++;

  // Per-trial clock pair, read back to back (see notes at top of file).
  const wall = Date.now();
  const perf = performance.now();

  current = {
    sessionId: session.sessionId,
    subject: session.subject,
    trialNum,
    taskMode: session.taskMode,        // 'anywhere' or 'dot'
    trialStartIso: new Date(wall).toISOString(),
    trialStartWallMs: wall,
    trialStartPerfMs: perf,
    wallMinusPerfMs: wall - perf,
    dotX: x,
    dotY: y,
    dotRadiusPx: r,
    hitRadiusPx: anywhere ? null : r + CONFIG.hitTolerancePx,
    screenW: window.innerWidth,
    screenH: window.innerHeight,
    itiTouchesBefore: itiTouchCount,   // touches since the previous trial ended
    dotOnsetPerfMs: null,              // dot or green-screen onset
    outcome: null,                     // 'hit' | 'miss' | 'timeout' | 'aborted'
    touchX: null,
    touchY: null,
    touchDistPx: null,
    touchPerfMs: null,
    rtMs: null,                        // reaction time = touch - dot onset
    pointerType: null,                 // 'touch', 'pen' or 'mouse'
    rewardMode: session.rewardMode,    // 'juice' or 'practice'
    rewardPerfMs: null,                // when the reward was triggered (hits)
    rewardRequestedMl: null,           // mL entered at the moment of the hit
    rewardDurationMs: null,            // pump run time sent to the Arduino
    rewardEstimatedMl: null,           // run time x 90 mL/min (an estimate)
    rewardStatus: null,                // 'delivered', 'practice', or 'failed: ...'
    rewardDonePerfMs: null,            // when the Arduino confirmed the stop
    trialEndWallMs: null,
    trialEndPerfMs: null,
    exported: 0,
  };
  itiTouchCount = 0;

  // Draw the target: the whole screen green, or the dot.
  if (anywhere) {
    setArenaColor(CONFIG.anywhereColor);
  } else {
    drawDot(x, y, r);
  }

  // requestAnimationFrame runs just before the browser paints the next frame;
  // its timestamp (perf clock) is our best estimate of target onset. It
  // physically lights up on the display within about one frame after this.
  const thisTrial = current;
  requestAnimationFrame((t) => { if (current === thisTrial) thisTrial.dotOnsetPerfMs = t; });

  state = 'dotOn';
  // The dot task times out; the touch-anywhere task waits indefinitely.
  if (!anywhere) responseTimer = setTimeout(() => endTrial('timeout', null), CONFIG.responseWindowMs);
}

function drawDot(x, y, r) {
  els.dot.style.width = els.dot.style.height = `${2 * r}px`;
  els.dot.style.left = `${x - r}px`;
  els.dot.style.top = `${y - r}px`;
  els.dot.hidden = false;
}

// Every touch on the task area comes here.
els.arena.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (state === 'dotOn' && current) {
    if (current.taskMode === 'anywhere') { endTrial('hit', e, null); return; }
    const d = Math.hypot(e.clientX - current.dotX, e.clientY - current.dotY);
    endTrial(d <= current.hitRadiusPx ? 'hit' : 'miss', e, d);
  } else if (state === 'iti' || state === 'reward') {
    itiTouchCount++;
    const restart = session && session.taskMode === 'anywhere'
      ? CONFIG.anywhereTouchRestartsCooldown : CONFIG.itiTouchRestartsDelay;
    if (state === 'iti' && restart) scheduleNextTrial(0);
  }
});

// Finish the trial on screen. `e` is the touch event (null for timeout/abort).
function endTrial(outcome, e, dist) {
  if (state !== 'dotOn' || !current) return;
  clearTimeout(responseTimer);
  responseTimer = null;
  els.dot.hidden = true;
  setArenaColor(betweenTrialsColor()); // black during juice, unless staying green

  const t = current;
  current = null;
  t.outcome = outcome;

  if (e) {
    t.touchX = e.clientX;
    t.touchY = e.clientY;
    t.touchDistPx = dist;
    t.touchPerfMs = e.timeStamp;   // when the touch happened (perf clock)
    t.pointerType = e.pointerType;
    if (t.dotOnsetPerfMs !== null) t.rtMs = e.timeStamp - t.dotOnsetPerfMs;
  }
  t.trialEndWallMs = Date.now();
  t.trialEndPerfMs = performance.now();
  counts[outcome]++;

  if (outcome === 'hit') {
    t.rewardPerfMs = performance.now();
    playTone(CONFIG.rewardToneHz, CONFIG.rewardToneMs, CONFIG.rewardToneVolume);
    if (session.rewardMode === 'juice') {
      deliverJuice(t); // saves the trial, waits for the pump, then continues
      return;
    }
    t.rewardStatus = 'practice';
  }

  saveTrial(t);   // runs in the background; the next ITI starts right away
  if (outcome === 'aborted') return; // pausing: don't start another trial
  scheduleNextTrial(outcome === 'hit' ? 0 : CONFIG.errorPenaltyMs);
}

// Save a trial. The first save gives the trial its database key (trialKey);
// saving it again later (with the reward result) overwrites the same record.
async function saveTrial(t) {
  try {
    t.trialKey = await dbPut('trials', t);
  } catch (err) {
    counts.saveErrors++;
    console.error('Trial save failed', err, t);
  }
}

// =============================================================================
// REWARD
// =============================================================================

// Is the pump connected, idle and ready for a command?
function pumpReady() {
  return !!link.device?.gatt.connected && link.phase === 'idle' && !link.pending && !runner.busy;
}

// Returns a message describing why juice can't be given, or '' if all is well.
function juiceProblem() {
  if (!pumpReady()) return link.phase === 'running' || runner.busy
    ? 'Wait for the pump to stop.' : 'Connect the pump first.';
  try { rewardPlan(Number(els.rewardMl.value)); } catch (e) { return e.message; }
  return '';
}

// Give juice for one hit, then start the next trial only once the pump has
// confirmed it stopped. The mL value is read at the moment of the hit, so
// editing it later affects the next hit, never the one being delivered.
async function deliverJuice(t) {
  state = 'reward';
  const token = runToken;
  const ml = els.rewardMl.value === '' ? NaN : Number(els.rewardMl.value);
  t.rewardRequestedMl = Number.isFinite(ml) ? ml : null;

  let plan;
  try {
    plan = rewardPlan(ml); // throws if the amount is empty or outside 0.15–90 mL
  } catch (err) {
    t.rewardStatus = 'failed: ' + err.message;
    counts.rewardFailures++;
    saveTrial(t);
    haltTask('No juice sent: ' + err.message);
    return;
  }
  t.rewardDurationMs = plan.durationMs;
  t.rewardEstimatedMl = plan.volume;

  const firstSave = saveTrial(t); // save now, in case the battery dies mid-reward
  try {
    await runner.pulse(plan.durationMs / 1000);
    t.rewardStatus = 'delivered';
    t.rewardDonePerfMs = performance.now();
    counts.rewardsDelivered++;
  } catch (err) {
    t.rewardStatus = 'failed: ' + err.message;
    counts.rewardFailures++;
  }
  await firstSave;
  await saveTrial(t); // update the same record with the reward result

  if (token !== runToken) return; // the task was paused during the reward
  if (t.rewardStatus === 'delivered') scheduleNextTrial(0);
  else haltTask('Reward failed: ' + t.rewardStatus.slice(8));
}

// Stop the pump if it is connected; never throws.
function stopPumpQuietly() {
  if (link.device?.gatt.connected) runner.stop().catch(() => {});
}

function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { console.warn('Audio unavailable', e); }
}

// A short beep made by the browser's built-in synthesizer (no sound file).
function playTone(freqHz, durMs, volume) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const t0 = audioCtx.currentTime;
  const t1 = t0 + durMs / 1000;
  osc.frequency.value = freqHz;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t1); // fade out to avoid a click
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t1);
}

// =============================================================================
// PUMP CONTROLS (shared by the start screen and the panel)
// =============================================================================

// There is one set of pump controls; move it into whichever screen is showing.
function placePumpBox(slot) { slot.appendChild(els.pumpBox); refreshPump(); }

// requestDevice (the Bluetooth chooser) must run directly inside the tap.
els.connectBtn.addEventListener('click', () => { link.connect(); });
els.disconnectBtn.addEventListener('click', async () => {
  if (session && session.rewardMode === 'juice') pauseTask();
  await link.disconnect();
});
els.stopPumpBtn.addEventListener('click', () => { runner.stop().catch(() => {}); });

els.rewardMl.addEventListener('input', () => {
  try { localStorage.setItem(REWARD_ML_KEY, els.rewardMl.value); } catch (e) { /* ignore */ }
  refreshPump();
});

// Hand reward: one pulse of the current amount (also handy for priming the line).
els.giveRewardBtn.addEventListener('click', async () => {
  let plan;
  try { plan = rewardPlan(Number(els.rewardMl.value)); }
  catch (e) { els.pumpNote.hidden = false; els.pumpNote.textContent = e.message; return; }
  let status = 'delivered';
  try { await runner.pulse(plan.durationMs / 1000); }
  catch (e) { status = 'failed: ' + e.message; }
  logEvent('manualReward', `${plan.requestedMl} mL, ${plan.durationMs} ms, ${status}`);
  els.pumpNote.hidden = false;
  els.pumpNote.textContent = status === 'delivered' ? 'Manual reward delivered.' : 'Manual reward ' + status;
  refreshPump();
});

// Called whenever the pump's state changes.
link.addEventListener('change', () => {
  const phase = link.phase;
  if (phase === 'idle' && ['offline', 'connecting', 'checking'].includes(lastPumpPhase)) {
    logEvent('pumpConnected', link.device?.name || '');
  }
  if (phase === 'offline' && lastPumpPhase !== 'offline') {
    logEvent('pumpDisconnected', link.message || '');
    // A juice session cannot continue without the pump.
    if (session && session.rewardMode === 'juice' && state !== 'paused') {
      haltTask('Pump disconnected' + (link.message ? ': ' + link.message : '.'));
    }
  }
  lastPumpPhase = phase;
  refreshPump();
});

function refreshPump() {
  const connected = !!link.device?.gatt.connected && !['offline', 'connecting'].includes(link.phase);
  els.pumpLabel.textContent =
    link.phase === 'connecting' ? 'Connecting…'
    : link.phase === 'running' ? `${link.device?.name || 'Pump'}: running`
    : connected ? `${link.device?.name || 'Pump'} connected`
    : (link.message || 'Not connected');
  els.connectBtn.hidden = connected;
  els.connectBtn.disabled = !navigator.bluetooth || !window.isSecureContext || link.phase === 'connecting';
  els.disconnectBtn.hidden = !connected;

  let planOK = false;
  try {
    const plan = rewardPlan(Number(els.rewardMl.value));
    planOK = els.rewardMl.value !== '';
    els.dosePreview.textContent = `= ${(plan.durationMs / 1000).toFixed(3)} s pump run at ${PUMP_ML_PER_MINUTE} mL/min (estimate)`;
  } catch (e) {
    els.dosePreview.textContent = e.message;
  }
  // Manual reward only while no trial is running (the task is paused, or no session).
  const taskIdle = !session || state === 'paused';
  els.giveRewardBtn.disabled = !pumpReady() || !planOK || !taskIdle;
  els.stopPumpBtn.disabled = !connected;
  els.startJuiceBtn.disabled = !pumpReady() || !planOK;
}

// =============================================================================
// SCREEN: FULLSCREEN AND WAKE LOCK
// =============================================================================
function enterFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* already fullscreen as installed app */ });
  }
}
function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { console.warn('Wake lock failed', e); }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

// =============================================================================
// PAUSE / HALT / RESUME
// =============================================================================

// Pause: stop everything (including the pump) and wait.
function pauseTask() {
  runToken++;                                       // cancels any reward in progress
  if (state === 'dotOn') endTrial('aborted', null); // record the interrupted trial
  clearTimeout(itiTimer);
  clearTimeout(responseTimer);
  itiTimer = responseTimer = null;
  els.dot.hidden = true;
  setArenaColor(CONFIG.backgroundColor);
  stopPumpQuietly();
  if (session) state = 'paused';
  refreshPump();
}

// Halt: the task stopped ITSELF (pump problem, app hidden). It stays on a
// black screen with a dim note, and does NOT open the panel, so the monkey
// can't press panel buttons. The experimenter opens the panel with the
// corner taps, fixes the problem, and taps Resume.
function haltTask(reason) {
  pauseTask();
  logEvent('taskHalted', reason);
  els.haltMsg.textContent = `Paused: ${reason} Experimenter: tap corners top-left, top-right, top-left.`;
  els.haltMsg.hidden = false;
}

function resumeTask() {
  if (!session) return;
  if (session.rewardMode === 'juice') {
    const problem = juiceProblem();
    if (problem) { els.adminMsg.textContent = 'Can\'t resume a juice session yet: ' + problem; return; }
  }
  logEvent('taskResumed');
  els.haltMsg.hidden = true;
  closeAdmin();
  enterFullscreen();
  requestWakeLock();
  scheduleNextTrial(0);
}

// =============================================================================
// HIDDEN GESTURE: top-left, top-right, top-left within adminTapWindowMs
// =============================================================================
let cornerTaps = [];
function onCornerTap(corner, e) {
  e.preventDefault();
  e.stopPropagation();
  const now = performance.now();
  cornerTaps = cornerTaps.filter((c) => now - c.t < CONFIG.adminTapWindowMs);
  cornerTaps.push({ corner, t: now });
  const lastThree = cornerTaps.slice(-3).map((c) => c.corner).join(',');
  if (lastThree === 'TL,TR,TL') { cornerTaps = []; openAdmin(); }
}
els.cornerTL.addEventListener('pointerdown', (e) => onCornerTap('TL', e));
els.cornerTR.addEventListener('pointerdown', (e) => onCornerTap('TR', e));

// =============================================================================
// EXPERIMENTER PANEL
// =============================================================================
els.startAdminBtn.addEventListener('click', openAdmin);
els.closeAdminBtn.addEventListener('click', closeAdmin);
els.resumeBtn.addEventListener('click', resumeTask);
els.endBtn.addEventListener('click', () => {
  if (confirm('End this session?')) endSession();
});

async function openAdmin() {
  if (session && state !== 'paused') { pauseTask(); logEvent('taskPaused', 'panel opened'); }
  if (session) await saveSession(); // keep the session record current
  placePumpBox(els.pumpSlotAdmin);
  els.admin.hidden = false;
  els.adminMsg.textContent = '';
  els.clockMsg.textContent = '';
  // Buttons that only make sense during a session vs. on the start screen
  els.resumeBtn.hidden = !session;
  els.endBtn.hidden = !session;
  els.closeAdminBtn.hidden = !!session;
  // Live tablet clock, so you can compare it against a reference by eye.
  clearInterval(clockTimer);
  clockTimer = setInterval(updateTabletClock, 50);
  refreshAdminStatus();
}
function closeAdmin() {
  els.admin.hidden = true;
  clearInterval(clockTimer);
  placePumpBox(els.pumpSlotStart);
  refreshStartStatus();
}
function updateTabletClock() {
  const d = new Date();
  const p = (n, k = 2) => String(n).padStart(k, '0');
  els.tabletClock.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ---------- Export / clear ----------
els.exportBtn.addEventListener('click', async () => {
  els.exportBtn.disabled = true;
  els.adminMsg.textContent = 'Exporting…';
  try {
    const r = await exportAllData();
    els.adminMsg.textContent = r.files.length === 0
      ? 'Nothing to export.'
      : `Saved to Downloads: ${r.files.join(' and ')} (${r.nTrials} trials, ${r.nSessions} sessions, ${r.nClockChecks} clock checks). Check both files are there before clearing.`;
  } catch (e) {
    els.adminMsg.textContent = 'Export FAILED: ' + e;
  }
  els.exportBtn.disabled = false;
  refreshAdminStatus();
});

els.clearBtn.addEventListener('click', async () => {
  if (!confirm('Delete all ALREADY-EXPORTED data from the tablet\'s database?\n\n' +
               'Only do this after checking the exported files are in Downloads (or copied off the tablet). ' +
               'Data that has not been exported is kept.')) return;
  try {
    const r = await clearExportedData();
    els.adminMsg.textContent = `Cleared ${r.nTrials} trials, ${r.nSessions} sessions, ${r.nClockChecks} clock checks, ${r.nEvents} events.`;
    if (session) await saveSession(); // put the running session's record back
  } catch (e) {
    els.adminMsg.textContent = 'Clear FAILED: ' + e;
  }
  refreshAdminStatus();
});

// ---------- Clock checks ----------
// Each check saves: the tablet's wall clock, the perf clock, the reference
// time, and offsetMs = tablet - reference (positive = tablet is ahead).

async function saveClockCheck(rec) {
  rec.sessionId = session ? session.sessionId : null;
  rec.exported = 0;
  await dbPut('clockChecks', rec);
  refreshAdminStatus();
}

// MANUAL check (works offline):
// 1. Look at a trusted clock showing seconds (e.g. a phone with automatic
//    network time, or time.gov on a computer).
// 2. Type a time a few seconds in the future, e.g. 14:05:30.
// 3. Tap "Log manual check" exactly as the reference clock reaches that time.
// Accuracy is limited by your reaction time (a few hundred ms), which is fine
// for tracking drift over days.
els.manualClockBtn.addEventListener('click', async () => {
  // Read the clocks FIRST, before anything else, to minimise delay.
  const wall = Date.now();
  const perf = performance.now();
  const txt = els.refTimeInput.value.trim();
  const m = txt.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) { els.clockMsg.textContent = 'Type the reference time as HH:MM:SS (24-hour), e.g. 14:05:30.'; return; }

  // Build the reference time on today's date (local time). If that is more
  // than 12 h away from the tablet's time, assume it was across midnight.
  const ref = new Date(wall);
  ref.setHours(+m[1], +m[2], +m[3], 0);
  let refMs = ref.getTime();
  if (refMs - wall > 12 * 3600e3) refMs -= 24 * 3600e3;
  if (wall - refMs > 12 * 3600e3) refMs += 24 * 3600e3;

  const offsetMs = wall - refMs;
  await saveClockCheck({
    method: 'manual',
    referenceText: txt,
    referenceMs: refMs,
    tabletWallMs: wall,
    tabletPerfMs: perf,
    tabletIso: new Date(wall).toISOString(),
    offsetMs,
    uncertaintyMs: null, // human reaction time; typically ~200–400 ms
  });
  els.clockMsg.textContent = `Logged. Tablet is ${fmtOffset(offsetMs)} the reference.`;
  els.refTimeInput.value = '';
});

// ONLINE check (only when on Wi-Fi, e.g. when you are exporting):
// asks the web server for its time (the HTTP "Date" header).
// That header has 1-second resolution, so the result is good to roughly
// ±0.5 s plus half the network round trip, with no typing needed.
els.onlineClockBtn.addEventListener('click', async () => {
  els.clockMsg.textContent = 'Asking the server for the time…';
  try {
    const perf0 = performance.now();
    const wall0 = Date.now();
    // "?clockcheck" tells the service worker to skip its cache (see sw.js).
    const resp = await fetch(`./manifest.json?clockcheck=${wall0}`, { cache: 'no-store' });
    const perf1 = performance.now();
    const dateHeader = resp.headers.get('Date');
    if (!dateHeader) throw new Error('no Date header in reply');

    // The server stamped its time somewhere between our request and its reply;
    // assume the midpoint. The header drops fractions of a second, so the true
    // server time is, on average, 500 ms later than the header says.
    const rttMs = perf1 - perf0;
    const tabletWallMid = wall0 + rttMs / 2;
    const serverMs = Date.parse(dateHeader) + 500;
    const offsetMs = tabletWallMid - serverMs;

    await saveClockCheck({
      method: 'online',
      referenceText: dateHeader,
      referenceMs: serverMs,
      tabletWallMs: tabletWallMid,
      tabletPerfMs: perf0 + rttMs / 2,
      tabletIso: new Date(tabletWallMid).toISOString(),
      offsetMs,
      uncertaintyMs: 500 + rttMs / 2,
      roundTripMs: rttMs,
    });
    els.clockMsg.textContent = `Logged. Tablet is ${fmtOffset(offsetMs)} the server (±${Math.round(500 + rttMs / 2)} ms).`;
  } catch (e) {
    els.clockMsg.textContent = 'Online check failed (no Wi-Fi?): ' + e.message;
  }
});

function fmtOffset(ms) {
  const s = (Math.abs(ms) / 1000).toFixed(2);
  return ms >= 0 ? `${s} s ahead of` : `${s} s behind`;
}

// ---------- Status displays ----------
async function storageSummary() {
  const [nTrials, nUnexported, nSessions, nChecks] = await Promise.all([
    dbCount('trials'), dbCount('trials', 0), dbCount('sessions'), dbCount('clockChecks'),
  ]);
  let used = '?', quota = '?', persisted = '?';
  try {
    const est = await navigator.storage.estimate();
    used = (est.usage / 1e6).toFixed(1);
    quota = (est.quota / 1e6).toFixed(0);
    persisted = (await navigator.storage.persisted()) ? 'yes' : 'NO';
  } catch (e) { /* ignore */ }
  let lastExport = 'never';
  try { lastExport = localStorage.getItem('lastExportIso') || 'never'; } catch (e) { /* ignore */ }
  const offline = navigator.serviceWorker && navigator.serviceWorker.controller ? 'yes' : 'NOT YET (reload once on Wi-Fi)';
  const installed = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches;
  return { nTrials, nUnexported, nSessions, nChecks, used, quota, persisted, lastExport, offline, installed };
}

async function refreshStartStatus() {
  try {
    const s = await storageSummary();
    els.startStatus.innerHTML =
      `Stored: ${s.nTrials} trials (${s.nUnexported} not yet exported), ${s.nSessions} sessions<br>` +
      `Storage used: ${s.used} MB of ${s.quota} MB · Protected from auto-deletion: ${s.persisted}<br>` +
      `Ready offline: ${s.offline} · Installed as app: ${s.installed ? 'yes' : 'NO (use "Add to Home screen")'}<br>` +
      `Last export: ${s.lastExport}`;
  } catch (e) { els.startStatus.textContent = 'Storage error: ' + e; }
}

async function refreshAdminStatus() {
  try {
    const s = await storageSummary();
    const c = counts;
    const sessionLine = session
      ? `<b>Session:</b> ${session.sessionId} (${session.taskMode === 'anywhere' ? 'touch anywhere' : 'dot'}, ${session.rewardMode === 'juice' ? 'juice' : 'practice, no juice'})<br>` +
        `Trials ${trialNum}: ${c.hit} hit, ${c.miss} miss, ${c.timeout} timeout, ${c.aborted} aborted · ` +
        `juice delivered ${c.rewardsDelivered}` +
        (c.rewardFailures ? ` · <span class="warn">${c.rewardFailures} reward failures</span>` : '') +
        (c.saveErrors ? `<br><span class="warn">${c.saveErrors} SAVE ERRORS: export now</span>` : '') + '<br>'
      : '<b>No session running.</b><br>';
    els.adminStatus.innerHTML = sessionLine +
      `<b>Stored on tablet:</b> ${s.nTrials} trials (${s.nUnexported} not exported), ${s.nSessions} sessions, ${s.nChecks} clock checks<br>` +
      `Storage used: ${s.used} MB of ${s.quota} MB · Protected: ${s.persisted}<br>` +
      `Last export: ${s.lastExport}`;
  } catch (e) { els.adminStatus.textContent = 'Storage error: ' + e; }
  refreshPump();
}
