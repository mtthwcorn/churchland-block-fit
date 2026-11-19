import {ButtonPumpLink, doseMilliseconds, doseVolume} from './button-link.mjs';

const $ = id => document.getElementById(id);
const link = new ButtonPumpLink();
let lastRead = null;
const format = n => new Intl.NumberFormat('en-US', {maximumFractionDigits: 4}).format(n);
function preview() {
  try {
    $('duration').textContent = $('enabled').checked
      ? `${format(doseMilliseconds(Number($('dose-ml').value)) / 1000)} seconds per press`
      : 'Physical button will be disabled.';
  } catch (error) { $('duration').textContent = error.message; }
  $('dose-ml').disabled = !$('enabled').checked || link.savingSettings || link.phase === 'running';
}
function render() {
  const offline = link.phase === 'offline';
  const busy = link.loadingSettings || link.savingSettings || !!link.pending;
  const ready = link.phase === 'idle' && !busy && link.buttonMs !== null;
  $('status').textContent = link.savingSettings ? 'Saving…' : link.loadingSettings ? 'Reading settings…' : ({offline:'Not connected',connecting:'Connecting…',checking:'Checking pump…',idle:'Connected',running:'Dispensing…'}[link.phase]);
  $('connect').hidden = !offline;
  $('disconnect').hidden = offline;
  $('disconnect').disabled = link.phase === 'connecting';
  $('give').disabled = !ready || !link.buttonMs;
  $('give').textContent = link.phase === 'running' ? 'Dispensing…' : 'Give juice';
  $('stop').disabled = offline || link.phase === 'connecting';
  $('save').disabled = !ready;
  $('enabled').disabled = link.savingSettings || link.phase === 'running';
  $('amount').textContent = link.buttonMs ? format(doseVolume(link.buttonMs)) : '—';
  $('saved-state').textContent = link.buttonMs === null ? 'Connect to read the saved dose.'
    : link.buttonMs === 0 ? 'Physical button disabled.' : 'One press. One dose.';
  if (link.buttonMs !== null && link.buttonMs !== lastRead) {
    $('enabled').checked = link.buttonMs > 0;
    if (link.buttonMs) $('dose-ml').value = format(doseVolume(link.buttonMs));
  }
  lastRead = link.buttonMs;
  $('message').textContent = !navigator.bluetooth
    ? 'Use Chrome on Android or a computer with Bluetooth.' : link.message;
  $('connect').disabled = !navigator.bluetooth;
  preview();
}
function route() {
  const settings = location.hash === '#settings';
  $('pump-page').hidden = settings;
  $('settings-page').hidden = !settings;
  $('pump-tab').setAttribute('aria-current', settings ? 'false' : 'page');
  $('settings-tab').setAttribute('aria-current', settings ? 'page' : 'false');
}
$('connect').addEventListener('click', () => link.connect());
$('disconnect').addEventListener('click', () => link.disconnect());
$('give').addEventListener('click', () => link.give());
$('give').addEventListener('keydown', event => {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
});
$('stop').addEventListener('click', () => link.stop());
$('dose-ml').addEventListener('input', preview);
$('enabled').addEventListener('change', preview);
$('settings-page').addEventListener('submit', async event => {
  event.preventDefault();
  try { await link.saveDose(Number($('dose-ml').value), $('enabled').checked); }
  catch (error) { $('message').textContent = error.message; }
});
link.addEventListener('change', render);
window.addEventListener('hashchange', route);
// A browser-triggered pulse keeps the existing heartbeat safety; local button
// pulses have their own board timer and do not need the page to stay open.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && link.heartbeat) link.stop();
});
window.addEventListener('pagehide', () => link.drop(''));
route(); render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
