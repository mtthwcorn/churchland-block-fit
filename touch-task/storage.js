// =============================================================================
// storage.js — SAVING DATA ON THE TABLET, AND EXPORTING IT
// -----------------------------------------------------------------------------
// Data is kept in two places:
//
//   1. IndexedDB — a small database built into the browser. Every trial is
//      written here the moment it ends, so a dead battery or a crash loses at
//      most the trial in progress. Nothing here needs the internet.
//
//   2. Files in the tablet's Downloads folder — created when you press
//      "Export" in the experimenter panel. These are ordinary files you can
//      copy to a computer or an external drive like any other download.
//
// Data in IndexedDB is NEVER deleted automatically. It is only removed when
// you press "Clear exported data", and even then only records that were
// already exported are removed.
//
// WARNING: uninstalling the app, or clearing Chrome's "site data" for this
// website, wipes IndexedDB. Export first!
// =============================================================================

const DB_NAME = 'nhp-touch-task';
const DB_VERSION = 2; // only change this if you change the database layout below
                      // (v2 added the `events` store; existing data is kept)

// The database has three "object stores" (think: three tables):
//   sessions    — one record per session (subject, start/end clocks, settings)
//   trials      — one record per trial
//   clockChecks — one record per clock check (tablet clock vs. a reference)
//   events      — everything else worth a timestamp: pump connected or
//                 disconnected, task paused/resumed and why, manual rewards
//
// Every record has an `exported` field: 0 = not exported yet, 1 = exported.
// (We use 0/1 instead of true/false because IndexedDB cannot index booleans.)

let dbPromise = null;

// Open (and on first use, create) the database. Returns a Promise.
function openDB() {
  if (dbPromise) return dbPromise; // reuse the same connection
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Runs only the first time (or when DB_VERSION goes up): create tables.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        s.createIndex('exported', 'exported');
      }
      if (!db.objectStoreNames.contains('trials')) {
        // autoIncrement: the database assigns trialKey = 1, 2, 3, ... itself
        const t = db.createObjectStore('trials', { keyPath: 'trialKey', autoIncrement: true });
        t.createIndex('exported', 'exported');
        t.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('clockChecks')) {
        const c = db.createObjectStore('clockChecks', { keyPath: 'checkKey', autoIncrement: true });
        c.createIndex('exported', 'exported');
      }
      if (!db.objectStoreNames.contains('events')) {
        const ev = db.createObjectStore('events', { keyPath: 'eventKey', autoIncrement: true });
        ev.createIndex('exported', 'exported');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Small helper: run a function inside a database transaction and resolve
// only when the transaction has COMPLETED (i.e. the data is safely written).
// durability 'strict' asks the browser to flush to disk before reporting
// success, which matters if the battery dies right after a trial.
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode, { durability: 'strict' });
    const store = tx.objectStore(storeName);
    let result;
    fn(store, (r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Insert or overwrite one record. Returns its key.
function dbPut(storeName, record) {
  return withStore(storeName, 'readwrite', (store, setResult) => {
    const req = store.put(record);
    req.onsuccess = () => setResult(req.result);
  });
}

// Read every record in a store.
function dbGetAll(storeName) {
  return withStore(storeName, 'readonly', (store, setResult) => {
    const req = store.getAll();
    req.onsuccess = () => setResult(req.result);
  });
}

// Count records. If `exportedValue` is given (0 or 1), count only those.
function dbCount(storeName, exportedValue) {
  return withStore(storeName, 'readonly', (store, setResult) => {
    const req = exportedValue === undefined
      ? store.count()
      : store.index('exported').count(IDBKeyRange.only(exportedValue));
    req.onsuccess = () => setResult(req.result);
  });
}

// Mark the listed records as exported (exported = 1).
// We pass the exact keys that went into the export file, so a record that was
// written after the export started can never be marked by mistake.
function dbMarkExported(storeName, keys) {
  return withStore(storeName, 'readwrite', (store) => {
    for (const key of keys) {
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const rec = getReq.result;
        if (rec) { rec.exported = 1; store.put(rec); }
      };
    }
  });
}

// Delete every record whose exported flag is 1. Returns how many were deleted.
function dbDeleteExported(storeName) {
  return withStore(storeName, 'readwrite', (store, setResult) => {
    let n = 0;
    const cursorReq = store.index('exported').openCursor(IDBKeyRange.only(1));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) { cursor.delete(); n++; cursor.continue(); }
      else setResult(n);
    };
  });
}

// -----------------------------------------------------------------------------
// Exporting to files
// -----------------------------------------------------------------------------

// Save a text string as a file in the tablet's Downloads folder.
function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Turn a list of trial records into CSV text (one row per trial).
// Columns are every field that appears in any trial, in first-seen order.
function trialsToCSV(trials) {
  const columns = [];
  for (const t of trials) for (const k of Object.keys(t)) if (!columns.includes(k)) columns.push(k);

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Quote the value if it contains a comma, quote, or line break.
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = [columns.join(',')];
  for (const t of trials) lines.push(columns.map((c) => escape(t[c])).join(','));
  return lines.join('\n');
}

// "2026-11-10T14:03:22.123Z" -> "20261110-090322" (local time, file-name safe)
function fileTimestamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Export EVERYTHING currently stored (exported or not) to two files:
//   <prefix>_trials.csv — one row per trial; opens directly in Excel/MATLAB/pandas
//   <prefix>_full.json  — sessions, trials, clock checks and events; this is
//                         the complete record and the one to archive
// Then mark those records as exported so "Clear exported data" can remove them.
async function exportAllData() {
  const [sessions, trials, clockChecks, events] = await Promise.all([
    dbGetAll('sessions'), dbGetAll('trials'), dbGetAll('clockChecks'), dbGetAll('events'),
  ]);
  if (sessions.length + trials.length + clockChecks.length + events.length === 0) {
    return { nSessions: 0, nTrials: 0, nClockChecks: 0, files: [] };
  }

  const nowWall = Date.now();
  const nowPerf = performance.now();
  const subjects = [...new Set(sessions.map((s) => s.subject))].join('-') || 'nosubject';
  const prefix = `nhp_${subjects}_${fileTimestamp(nowWall)}`;

  const exportInfo = {
    exportedAtIso: new Date(nowWall).toISOString(),
    exportedAtWallMs: nowWall,
    exportedAtPerfMs: nowPerf,
    appVersion: CONFIG.appVersion,
    userAgent: navigator.userAgent,
    // Note: the `exported` field inside each record shows its status BEFORE
    // this export (0 = this is the first time it was exported).
  };

  const csvName = `${prefix}_trials.csv`;
  const jsonName = `${prefix}_full.json`;

  downloadText(csvName, trialsToCSV(trials), 'text/csv');
  // Chrome may ask once "Allow this site to download multiple files?" —
  // tap Allow. The short pause makes the second download more reliable.
  await sleep(1000);
  downloadText(jsonName, JSON.stringify({ exportInfo, sessions, trials, clockChecks, events }, null, 1), 'application/json');

  await dbMarkExported('sessions', sessions.map((s) => s.sessionId));
  await dbMarkExported('trials', trials.map((t) => t.trialKey));
  await dbMarkExported('clockChecks', clockChecks.map((c) => c.checkKey));
  await dbMarkExported('events', events.map((e) => e.eventKey));

  try { localStorage.setItem('lastExportIso', exportInfo.exportedAtIso); } catch (e) { /* ignore */ }

  return { nSessions: sessions.length, nTrials: trials.length, nClockChecks: clockChecks.length, files: [csvName, jsonName] };
}

// Remove everything that has already been exported. Records that have NOT
// been exported are always kept.
async function clearExportedData() {
  const nTrials = await dbDeleteExported('trials');
  const nSessions = await dbDeleteExported('sessions');
  const nClockChecks = await dbDeleteExported('clockChecks');
  const nEvents = await dbDeleteExported('events');
  return { nTrials, nSessions, nClockChecks, nEvents };
}
