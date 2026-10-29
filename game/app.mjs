import {PumpLink} from './ble.mjs';
import {BLOCKS, newPuzzle, fitBlock} from './engine.mjs';
import {PUMP_ML_PER_MINUTE, rewardPlan, PulseRunner} from './rewards.mjs';

const $ = id => document.getElementById(id);
const link = new PumpLink(), runner = new PulseRunner(link);
const format = value => Number(value.toFixed(3)).toLocaleString(undefined, {maximumFractionDigits: 3});
let puzzle = newPuzzle(), selected = null, mode = 'practice', paused = false;
let rewardMl = 0, operation = false, stopping = 0, inputLocked = false;
let restartTimer, pointer = null, ghost = null, ignoreClickUntil = 0;
let motionVersion = 0, motionAnimations = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let message = 'Drag a block into its matching space.', feedback = 'Fit the blocks.';
const rewardKey = 'pump-block-fit-reward-ml-v1';
try { $('reward-ml').value = localStorage.getItem(rewardKey) || localStorage.getItem('pump-2048-reward-ml-v2') || ''; } catch { /* Storage is optional. */ }

function renderPuzzle() {
  $('board').replaceChildren(...puzzle.slots.map(slot => {
    const block = BLOCKS.find(block => block.id === slot.id);
    const button = document.createElement('button');
    button.id = `slot-${block.id}`; button.dataset.slot = block.id;
    button.className = `slot ${block.color}`;
    button.style.gridArea = `${slot.y + 1} / ${slot.x + 1} / span ${slot.height} / span ${slot.width}`;
    button.innerHTML = '<svg class="checkmark" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';
    return button;
  }));
  $('tray').replaceChildren(...puzzle.order.map(id => {
    const block = BLOCKS.find(block => block.id === id);
    const button = document.createElement('button');
    button.id = `piece-${id}`; button.dataset.piece = id;
    button.className = `piece ${block.color}`;
    button.style.setProperty('--piece-width', `calc(var(--tray-unit) * ${block.width})`);
    button.style.setProperty('--piece-ratio', `${block.width} / ${block.height}`);
    button.setAttribute('aria-label', block.name);
    return button;
  }));
}
function cancelDrag() {
  if (pointer) $(`piece-${pointer.pieceId}`)?.classList.remove('dragging');
  pointer = null; ghost?.remove(); ghost = null;
}
function cancelMotion() {
  ++motionVersion;
  motionAnimations.forEach(animation => animation.cancel());
  motionAnimations = []; inputLocked = false; selected = null;
  cancelDrag();
}
function canPlay() { return !paused && !operation && !stopping && !inputLocked && !document.hidden; }
function selectPiece(id) {
  if (!canPlay() || puzzle.placed.includes(id) || !BLOCKS.some(block => block.id === id)) return;
  selected = selected === id ? null : id;
  feedback = selected ? 'Find its space.' : 'Fit the blocks.';
  message = selected ? 'Tap the space with the same shape.' : 'Drag a block into its matching space.';
  refresh(); requestWakeLock();
}
async function animateFit(id, from) {
  const target = $(`slot-${id}`);
  if (reducedMotion.matches || typeof target.animate !== 'function') return;
  const to = target.getBoundingClientRect();
  const frames = from ? [
    {transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width},${from.height/to.height})`,filter:'brightness(1.07)'},
    {transform:'translate(0,0) scale(1.035)',offset:.8,filter:'brightness(1.04)'},
    {transform:'translate(0,0) scale(1)',filter:'brightness(1)'}
  ] : [{transform:'scale(.9)',filter:'brightness(1.1)'},{transform:'scale(1.035)',offset:.7},{transform:'scale(1)',filter:'brightness(1)'}];
  target.style.zIndex = '2'; target.style.transformOrigin = 'top left';
  const animation = target.animate(frames,{duration:280,easing:'cubic-bezier(.16,1,.3,1)'});
  motionAnimations = [animation];
  await animation.finished.catch(() => {});
  target.style.zIndex = ''; target.style.transformOrigin = '';
}
async function placePiece(pieceId, slotId, from = null) {
  if (!canPlay()) return;
  const result = fitBlock(puzzle,pieceId,slotId);
  if (!result.accepted) {
    feedback = 'Try its matching space.'; message = 'Look for the same shape and color.'; refresh();
    return;
  }
  from ||= $(`piece-${pieceId}`).getBoundingClientRect();
  puzzle = result.puzzle; selected = null; inputLocked = true;
  const version = ++motionVersion;
  feedback = 'Nice fit!'; message = result.complete ? 'You fitted all three blocks.' : 'Now fit another block.';
  refresh(); requestWakeLock();
  await animateFit(pieceId,from);
  if (version !== motionVersion) return;
  if (result.complete && mode === 'rewards' && !paused) await payReward();
  if (version !== motionVersion) return;
  motionAnimations = []; inputLocked = false; refresh(); checkEnd();
}
function pumpReady() {
  return !!link.device?.gatt.connected && link.phase === 'idle' && !link.pending && !operation && !runner.busy && !stopping && !inputLocked && !pointer;
}
function refresh() {
  const connected = !!link.device?.gatt.connected && !['offline', 'connecting'].includes(link.phase);
  const active = mode === 'rewards' && !paused;
  const ready = pumpReady();
  $('connection-label').textContent = link.phase === 'connecting' ? 'Connecting…' : connected ? `${link.device.name || 'Pump'} connected` : link.message || 'Not connected';
  $('connect').hidden = connected;
  $('connect').disabled = !navigator.bluetooth || !window.isSecureContext || link.phase === 'connecting' || operation || !!stopping;
  $('disconnect').hidden = !connected;
  $('disconnect').disabled = !!stopping;
  let configOK = false;
  const entered = $('reward-ml').value !== '';
  try {
    const plan = rewardPlan(Number($('reward-ml').value)); configOK = true;
    $('dose-preview').textContent = `${format(plan.durationMs / 1000)} s / trial · estimated at ${PUMP_ML_PER_MINUTE} mL/min`;
  } catch (error) {
    $('dose-preview').textContent = entered ? error.message : `Estimated at ${PUMP_ML_PER_MINUTE} mL/min`;
  }
  $('reward-ml').setAttribute('aria-invalid', String(entered && !configOK));
  $('reward-ml').disabled = active || operation || !!stopping;
  $('start-rewards').disabled = !ready || !configOK || active;
  $('start-rewards').textContent = active ? 'Juice is on' : 'Start with juice';
  $('practice').hidden = mode === 'practice';
  $('practice').disabled = !!stopping;
  $('mode').textContent = paused ? 'Paused' : active ? 'Juice rewards on' : 'Practice mode';
  $('mode-dot').classList.toggle('live', active);
  $('feedback').textContent = feedback; $('message').textContent = message;
  $('footer-note').textContent = mode === 'rewards' ? `${format(rewardMl)} mL per trial · 90 mL/min` : 'Juice rewards are off.';
  $('pause').textContent = stopping ? 'Stopping…' : paused ? 'Resume' : 'Pause';
  $('pause').disabled = !!stopping || (paused && (operation || (mode === 'rewards' && (!ready || !configOK))));
  $('pause').classList.toggle('resuming', paused && !stopping);
  const complete = puzzle.placed.length === BLOCKS.length;
  $('board').classList.toggle('complete', complete);
  $('progress').setAttribute('aria-label', `${puzzle.placed.length} of 3 blocks fitted`);
  [...$('progress').children].forEach((dot,index) => dot.classList.toggle('filled',index < puzzle.placed.length));
  for (const block of BLOCKS) {
    const fitted = puzzle.placed.includes(block.id), piece = $(`piece-${block.id}`), slot = $(`slot-${block.id}`);
    piece.disabled = fitted || !canPlay();
    piece.classList.toggle('used',fitted); piece.classList.toggle('selected',selected === block.id);
    piece.setAttribute('aria-pressed',String(selected === block.id));
    slot.disabled = fitted || !canPlay(); slot.classList.toggle('fitted',fitted);
    slot.classList.toggle('hinted',selected === block.id && !fitted);
    slot.setAttribute('aria-label',fitted ? `${block.name} fitted` : `${block.name} space`);
  }
  $('overlay').hidden = !paused;
  $('overlay-description').textContent = mode === 'rewards' && !connected ? 'Reconnect your pump, or play practice.' : 'Tap Resume to keep playing.';
}
function freshBoard() {
  cancelMotion(); clearTimeout(restartTimer);
  puzzle = newPuzzle(Math.random,puzzle.layout);
  feedback = 'Fit the blocks.'; message = 'Drag a block into its matching space.';
  renderPuzzle(); refresh();
}
function checkEnd() {
  if (puzzle.placed.length !== BLOCKS.length || paused) return;
  feedback = 'All fitted!'; message = 'Here comes another puzzle.'; refresh();
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { if (!paused && !operation && !stopping && !document.hidden) freshBoard(); }, 1100);
}
async function pausePlay(reason = 'Session paused.') {
  cancelMotion(); paused = true; clearTimeout(restartTimer);
  feedback = 'Take a pause.'; message = reason;
  ++stopping; refresh();
  try { await runner.stop(); } finally { --stopping; refresh(); }
}
async function payReward() {
  operation = true; refresh();
  try {
    const plan = rewardPlan(rewardMl);
    feedback = 'Trial complete!'; message = `Juice reward · ${format(plan.requestedMl)} mL estimated.`;
    refresh(); await runner.pulse(plan.durationMs / 1000);
    message = 'Ready for the next trial.';
  } catch (error) {
    paused = true; feedback = 'Session paused.'; message = error.message;
  } finally { operation = false; refresh(); }
}
link.addEventListener('change', () => {
  if (link.phase === 'offline' && mode === 'rewards') {
    cancelMotion(); paused = true; clearTimeout(restartTimer);
    feedback = 'Pump disconnected.'; message = 'Reconnect to resume, or play practice. Missed rewards will not replay.';
  }
  refresh();
});
$('connect').addEventListener('click', () => { link.connect(); });
$('disconnect').addEventListener('click', async () => { await pausePlay('Pump disconnected.'); await link.disconnect(); });
$('reward-ml').addEventListener('input', () => {
  try { localStorage.setItem(rewardKey, $('reward-ml').value); } catch { /* The current amount still works without storage. */ }
  refresh();
});
function startRewards() {
  if (!pumpReady() || document.hidden) return;
  try {
    const plan = rewardPlan(Number($('reward-ml').value));
    rewardMl = plan.requestedMl; mode = 'rewards'; paused = false;
    feedback = 'Ready to play.'; message = 'Fit all three blocks to earn one juice reward.';
    refresh(); checkEnd(); requestWakeLock();
  } catch (error) { message = error.message; refresh(); }
}
$('start-rewards').addEventListener('click', startRewards);
function resumePractice() {
  if (stopping || operation || document.hidden) return;
  mode = 'practice'; paused = false;
  feedback = 'Fit the blocks.'; message = 'Practice mode. The pump will stay off.';
  refresh(); checkEnd(); requestWakeLock();
}
$('pause').addEventListener('click', () => {
  if (!paused) pausePlay();
  else if (mode === 'rewards') startRewards();
  else resumePractice();
});
$('practice').addEventListener('click', async () => {
  const stop = pausePlay('Switching to practice.'), version = motionVersion;
  await stop;
  if (version === motionVersion) resumePractice();
});
$('tray').addEventListener('click', event => {
  if (performance.now() < ignoreClickUntil) return;
  const piece = event.target.closest('[data-piece]');
  if (piece) selectPiece(piece.dataset.piece);
});
$('board').addEventListener('click', event => {
  const slot = event.target.closest('[data-slot]');
  if (!slot || !canPlay()) return;
  if (selected) placePiece(selected,slot.dataset.slot);
  else { feedback = 'Pick a block.'; message = 'Tap a colored block below, then its space.'; refresh(); }
});
$('tray').addEventListener('pointerdown', event => {
  const piece = event.target.closest('[data-piece]');
  if (!piece || !event.isPrimary || !canPlay() || puzzle.placed.includes(piece.dataset.piece) || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const rect = piece.getBoundingClientRect();
  pointer = {id:event.pointerId,pieceId:piece.dataset.piece,x:event.clientX,y:event.clientY,rect,dragged:false};
  piece.setPointerCapture(event.pointerId); requestWakeLock();
});
$('tray').addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId || !canPlay()) return;
  const dx=event.clientX-pointer.x, dy=event.clientY-pointer.y;
  if (!pointer.dragged && Math.hypot(dx,dy)<7) return;
  if (!pointer.dragged) {
    pointer.dragged=true; selected=pointer.pieceId;
    const piece=$(`piece-${pointer.pieceId}`);
    ghost=piece.cloneNode(true); ghost.removeAttribute('id'); ghost.removeAttribute('data-piece');
    ghost.className=piece.className+' drag-ghost'; ghost.setAttribute('aria-hidden','true'); ghost.tabIndex=-1;
    Object.assign(ghost.style,{left:`${pointer.rect.left}px`,top:`${pointer.rect.top}px`,width:`${pointer.rect.width}px`,height:`${pointer.rect.height}px`});
    document.body.append(ghost); piece.classList.add('dragging'); refresh();
  }
  ghost.style.transform=`translate(${dx}px,${dy}px) scale(1.04)`;
});
$('tray').addEventListener('pointerup', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const {pieceId,dragged}=pointer;
  const from=ghost?.getBoundingClientRect();
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-slot]');
  cancelDrag();
  if (!dragged) return;
  ignoreClickUntil=performance.now()+350;
  if (target) placePiece(pieceId,target.dataset.slot,from);
  else { feedback='Find its space.';message='Drag onto the matching shape, or tap its space.';refresh(); }
});
['pointercancel','lostpointercapture'].forEach(name=>$('tray').addEventListener(name,()=>{cancelDrag();refresh();}));
$('tray').addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('resize',()=>{cancelDrag();refresh();});
document.addEventListener('keydown',event=>{if(event.key==='Escape') pausePlay();});
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); requestWakeLock(); }
  catch { message = 'Use your browser’s full-screen or Add to Home screen option.'; refresh(); }
});
let wakeLock;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
  catch { /* The tablet's own screen timeout remains available. */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pausePlay('The page was hidden. Tap Resume to continue.'); }
});
window.addEventListener('pagehide', () => { cancelMotion(); runner.cancel?.(); paused = true; link.drop('Page closed.'); });
if (!window.isSecureContext) {
  $('support-note').hidden = false;
  $('support-note').textContent = 'Bluetooth needs HTTPS on this tablet. Practice is available here.';
} else if (!navigator.bluetooth) {
  $('support-note').hidden = false;
  $('support-note').textContent = 'Open in Chrome on Android to connect your pump. Practice is available here.';
}
renderPuzzle(); refresh();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
