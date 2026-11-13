# NHP Touch Task: setup and use guide

This is a touch task that runs fully offline on an Android tablet. It has two task modes:

- **Touch anywhere** (first training step): the whole screen turns green, and any touch gives juice.
- **Touch the dot**: only touches on the dot are rewarded.

Hits are rewarded with juice from the lab's Bluetooth Arduino pump, using the same protocol as the Block Fit game. Every trial is saved on the tablet as soon as it ends. You export the data to files whenever you choose.

## Where it lives

The task is in the `touch-task/` folder of the Block Fit repository (`mtthwcorn/churchland-block-fit`) and is published on the same Vercel site as Block Fit:

- Block Fit: `https://churchland-block-fit.vercel.app/` (unchanged)
- **Touch task: `https://churchland-block-fit.vercel.app/touch-task/`**

The two apps share the site but are separate: each has its own home-screen icon, offline cache and stored data.

## What's in the folder

| File | What it does | Edit it? |
|---|---|---|
| `config.js` | All task settings: task mode, green color, cooldown, dot size, timings, tone, default reward size | **Yes**, this is where you tune the task |
| `task.js` | The task, juice delivery, the clocks, and the experimenter panel | Only to change task logic |
| `ble.mjs`, `rewards.mjs` | The Bluetooth pump protocol: exact copies of Block Fit's `game/ble.mjs` and `game/rewards.mjs` | **No.** A test fails if they differ from Block Fit's |
| `storage.js` | Saving to the tablet's database, and exporting files | Rarely |
| `index.html`, `style.css` | Page layout and appearance | Rarely |
| `sw.js` | Offline caching. Its `FILES` list is the list of files in the task | Bump `CACHE_VERSION` when you change files |
| `manifest.json`, `icons/` | Let Android install the task as its own app | No |
| `build.mjs`, `package.json` | Build step that Vercel runs for this folder | No |
| `tests/` | Automatic checks. Vercel won't publish if any fail | Only to add tests |

---

## Part 1: How it gets published

The repository's `vercel.json` makes every deployment do four things, in order:

1. run Block Fit's tests
2. run this folder's tests
3. build Block Fit
4. build the task into `/touch-task/`

**If any test fails, nothing is published and the current site stays live.**

- **Commits to `main`** go to the live site automatically.
- **Pull requests** get their own Vercel preview address, shown in the pull request on GitHub. Use it to try a change on a tablet before merging.

> **Privacy note:** Only the task *code* is online. Behavioral data never leaves the tablet, because nothing in this app uploads it.

## Part 2: Install it on the tablet (one-time)

1. Connect the tablet to Wi-Fi and open `https://churchland-block-fit.vercel.app/touch-task/` in **Chrome**.
2. Wait a few seconds, then **reload the page once**. The start screen should say **Ready offline: yes**.
3. Install it: open Chrome's **⋮** menu and choose **Add to Home screen**, then **Install** (some versions say **Install app**). Always open the task from that home-screen icon from now on.
4. Check that the status line reads **Installed as app: yes** and **Protected from auto-deletion: yes**.
5. **Pair the pump.** Power on the tablet's Arduino (the same UNO R4 WiFi with the Eric Pump firmware that Block Fit uses), then tap **Connect pump** and choose the pump in Chrome's list.
   - Chrome will ask for Bluetooth / Nearby devices permission. Allow it.
   - On some Android versions, Location must be switched on for Bluetooth scanning.
   - Each tablet should connect to its own Arduino. Check the name shown after connecting.
6. **Test offline before you rely on it.** Turn on airplane mode, then turn **Bluetooth back on** (airplane mode turns it off). Close the app completely and reopen it from the icon. Connect the pump, use **Give one reward now** to check juice flows, run a few trials with your finger, export, and check that the files appear in **Files → Downloads**.

### Recommended tablet settings

- **Screen pinning:** Settings → Security → **App pinning** (the menu path varies by brand). Then open the app, open the app switcher, tap the app icon, and choose **Pin**. This matters even more now, because leaving the app pauses the task (see Part 3).
- Turn on **Do Not Disturb**, set **auto-rotate off** (locked in landscape), and set the volume so the reward tone is audible.

---

## Part 3: Daily use

1. Open the app from its icon, type the **subject** name, and choose the **Task**:
   - **Touch anywhere (green screen)**: the screen turns green, and any touch gives juice. The screen then goes black during the juice and a 1–1.5 s cooldown; touches then are counted but not rewarded. The green screen waits as long as needed, so there are no timeouts or misses.
   - **Touch the dot**: the dot task described below.

   The choice is remembered for next time and saved with each session.
2. Tap **Connect pump**. Enter **mL per hit**; the screen shows the matching pump run time at 90 mL/min.
3. Tap **Start with juice**. This button stays disabled until the pump is connected and the amount is valid. **Start practice (no juice)** runs the task with only the tone; the pump is never used.
4. On each hit, the tone plays and the tablet sends **one timed command** to the pump. The next trial starts only after the Arduino confirms the pump has stopped, so rewards never queue up.
5. To open the **experimenter panel**, tap the invisible **top-left, top-right, top-left** corners within 3 seconds. This pauses the task and stops the pump. In the panel you can:
   - connect or disconnect the pump
   - change **mL per hit**. The new amount applies from the next hit; the reward being delivered keeps the amount that was set when the hit happened.
   - **Give one reward now**, for hand-shaping or priming the line (logged as an event)
   - **Stop pump**
   - export data, log a clock check, **Resume task**, or **End session**

### When the task stops itself

These are the same safety rules as Block Fit. The task **stops on a black screen** and waits for you if:

- a reward fails: the pump disconnects, the pump stops early, or there's no stop confirmation
- the amount is empty or outside 0.15–90 mL when a hit happens
- the app goes to the background

A dim line at the bottom of the screen says why. The panel does **not** open by itself, so the monkey can't press its buttons. Open it with the corner taps, fix the problem (for example, reconnect the pump), and tap **Resume task**. A juice session won't resume until the pump is connected. **A missed reward is never replayed.**

This means that in the cage room, if the pump connection drops, the task stays stopped until someone comes back. It never keeps running trials without juice. The Arduino also stops the motor by itself if it loses contact with the tablet.

---

## Part 4: Getting data off the tablet

**Export.** In the panel, tap **Export all data to Downloads**. This writes two files to the tablet's Downloads folder:

- `nhp_<subject>_<date-time>_trials.csv`: one row per trial
- `nhp_<subject>_<date-time>_full.json`: the complete record, with sessions (including a snapshot of every setting used), trials, clock checks, and **events** (pump connects and disconnects, pauses and their reasons, manual rewards). **This is the file to archive.**

The first time, Chrome may ask *"Allow this site to download multiple files?"*. Tap **Allow**.

**Copy to your drive.** Use the Files app (and a USB drive with an OTG adapter), or connect the tablet to a computer.

**Clear the database.** Only do this after checking that the files are safely copied. Tap **Clear exported data from tablet…**. This deletes only records that were already exported.

**Nothing is ever deleted automatically.** Each export includes everything still stored.

> ⚠️ **Never uninstall the app, or clear Chrome's site data for this site, before exporting.** Either one erases the database. Updating the app (Part 6) does **not** touch your data.

---

## Part 5: Data fields and clocks

### Clocks

- **`...WallMs` (`Date.now()`)** is real-world time in milliseconds since 1970 (UTC). Use it for *when* something happened. Offline, nothing corrects it, so it can drift or jump.
- **`...PerfMs` (`performance.now()`)** is milliseconds since the app was opened, with sub-millisecond resolution. It never jumps. Use it for *intervals*. Touch, dot-onset and reward times are on this clock.

**Per-trial sync pair.** Each trial saves `trialStartWallMs`, `trialStartPerfMs` and their difference `wallMinusPerfMs`.

- To convert any perf-clock event in that trial to wall time, use `wall = perf + wallMinusPerfMs`.
- Plot `wallMinusPerfMs` against `trialNum`. A step means the wall clock was adjusted; a slope means the two clocks drift relative to each other.

**Clock checks** compare the tablet's wall clock with an outside reference. Do one at the start and end of each day if you can.

- **Online check** (when you're on Wi-Fi, for example while exporting): tap **Online check**. The app compares its clock to the web server's clock automatically. Accuracy is about ±0.5 s.
- **Manual check** (in the cage room, offline):
  1. Look at a trusted clock that shows seconds, such as your phone.
  2. Type a time a few seconds ahead, for example `14:05:30`.
  3. Tap **Log manual check** exactly when the reference clock reaches that time.

Each check stores `offsetMs`, which is tablet time minus reference time (positive means the tablet is ahead). To correct tablet wall times, interpolate `offsetMs` between checks, then compute `true_time = tablet_wall − offsetMs`.

### Trial fields (CSV columns)

| Field | Meaning |
|---|---|
| `trialNum`, `sessionId`, `subject` | Trial number within the session, the session ID, and the subject name |
| `taskMode` | `anywhere` or `dot` |
| `trialStartWallMs`, `trialStartPerfMs`, `wallMinusPerfMs` | The per-trial clock pair, and their difference |
| `dotOnsetPerfMs` | Start of the display frame that drew the dot (or turned the screen green). It can be up to one frame *before* `trialStartPerfMs`; that is expected. |
| `touchPerfMs`, `rtMs` | Time of the touch, and reaction time (`touchPerfMs − dotOnsetPerfMs`). In touch-anywhere mode this is the latency from green onset to the touch. |
| `outcome` | `hit`, `miss`, `timeout`, or `aborted` (the panel was opened while the dot was up) |
| `dotX`, `dotY`, `touchX`, `touchY`, `touchDistPx` | Positions in CSS pixels from the top-left corner, and the distance between dot and touch. In touch-anywhere mode only `touchX`/`touchY` are filled; the dot fields are empty. |
| `dotRadiusPx`, `hitRadiusPx` | Visible dot radius, and the radius that counts as a hit |
| `itiTouchesBefore` | Number of touches since the previous trial ended (during the reward and the blank interval or cooldown) |
| `rewardMode` | `juice` or `practice` |
| `rewardPerfMs` | When the hit triggered the reward |
| `rewardRequestedMl` | mL per hit at the moment of the hit |
| `rewardDurationMs` | Pump run time sent to the Arduino |
| `rewardEstimatedMl` | `rewardDurationMs` × 90 mL/min. This is an **estimate**, not measured flow |
| `rewardStatus` | `delivered` (the Arduino confirmed a full run), `practice`, or `failed: <reason>` |
| `rewardDonePerfMs` | When the Arduino confirmed the pump stopped |
| `trialEndWallMs`, `trialEndPerfMs` | The clock pair at the end of the trial |

### Loading in Python

```python
import json, pandas as pd
d = json.load(open("nhp_monkeyA_20261110-090322_full.json"))
trials = pd.DataFrame(d["trials"])
events = pd.DataFrame(d["events"])
checks = pd.DataFrame(d["clockChecks"])

trials["touchWallMs"] = trials["touchPerfMs"] + trials["wallMinusPerfMs"]
juice_ml = trials.loc[trials.rewardStatus == "delivered", "rewardEstimatedMl"].sum()
```

---

## Part 6: Changing the task

1. Edit the file on GitHub: open it in the `touch-task/` folder, click the ✏️ pencil icon, and make the change. To test before going live, choose **Create a new branch … and start a pull request** when committing, then use the pull request's Vercel preview address.
2. Bump **both** `CACHE_VERSION` in `sw.js` and `appVersion` in `config.js` (for example, `0.2.0` → `0.2.1`).
   - A test checks that the two match, so Vercel refuses to deploy if they don't.
   - The build also fingerprints the files, so tablets update even if you forget to bump.
3. Wait about 1 minute for the deployment to finish.
4. On the tablet, on Wi-Fi: open the app, close it completely, and open it again. The version number on the start screen should change.

**Keeping the pump code in sync:** if Block Fit's `game/ble.mjs` or `game/rewards.mjs` changes (for example, for new firmware), a test fails and the site won't deploy until you copy the new versions over `touch-task/ble.mjs` and `touch-task/rewards.mjs`. That way the task can never run a different pump protocol from Block Fit.

### Testing on a computer (optional)

With Node.js 22 installed, run `npm test` and then `npm run build` inside `touch-task/`. To try the built task, run `python3 -m http.server 8765 --directory dist` and open `http://localhost:8765/` in Chrome. Practice sessions work there. The real pump also connects from desktop Chrome if the computer has Bluetooth.
