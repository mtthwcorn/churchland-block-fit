# Churchland Block Fit

A simple touchscreen puzzle for Android tablets running Chrome. Three pieces fit into a square. Drag a piece into its matching space, or tap the piece and then the space. Completed puzzles start another trial automatically.

## Physical juice button

**[Open the juice button console](https://churchland-block-fit.vercel.app/pump/)** · **[Button settings](https://churchland-block-fit.vercel.app/pump/#settings)**

Connect a normally-open two-wire momentary button between **D2** and **GND**. Upload
[Eric Pump v3 firmware](firmware/README.md), then connect in the new console, set
**mL per press**, and save to Arduino. One press gives one timed dose; holding the
button does not repeat. The saved setting survives power cycles and works without
Bluetooth. The on-screen **Give juice** button uses the same saved dose.

The conversion remains **90 mL/min = 1.5 mL/s**, an estimate to verify against
collected liquid. The new console reads settings from the Arduino, confirms saves,
and detects older firmware. It includes an upload guide and firmware ZIP download.

Block Fit remains at `/`; the newer NHP task is available at `/touch-task/`. Their
per-trial reward amounts are separate from the physical-button setting.

## Juice rewards

Each tablet connects directly over Bluetooth to its own Arduino UNO R4 WiFi and pump using the existing Eric Pump firmware. No pump requests go through a cloud server.

- The game opens in practice mode and never starts the motor on load or connection.
- Connect the pump, enter **mL per trial**, and select **Start with juice**.
- Juice runs **once, only after all three blocks fit**. Blocks one and two dispense nothing.
- The fixed rate is **90 mL/min (1.5 mL/s)**. For example, 1.5 mL per trial produces a one-second command. Displayed volume is an estimate, not measured flow.
- Change **mL per trial** at any time without pausing. Each trial uses the amount entered when its third block fits. Edits after completion, including while juice is dispensing, apply to the next trial and do not alter the current pulse.
- If the amount is empty or outside 0.15–90 mL when a trial completes, no reward is sent and play pauses. Correct the amount and resume; that completed trial is not rewarded again.
- Pause stops the pump. Resume is explicit.
- The firmware accepts 0.1–60-second pulses, corresponding to 0.15–90 mL per trial.
- Hidden pages, lost connections, and failed pulses pause reward play. Interrupted rewards never replay automatically.
- The next trial waits until the pump has stopped. There is no accumulating reward queue.

Use trusted HTTPS on the tablets for Bluetooth access. The game caches itself for offline use after a successful visit; offline availability depends on the browser retaining its cache. Reopening still starts in practice mode. There is no calibration screen or session limit.

## Development

Use Node.js 22. No third-party JavaScript packages are required.

```sh
npm ci
npm run test:all
npm run test:firmware
npm run build
python3 -m http.server 8765 --directory dist
```

Open `http://localhost:8765/`. The build produces a standalone static site in `dist/`. Automated tests also check button debounce, saved-dose validation, settings readback and reconnection. Firmware compiles for `arduino:renesas_uno:unor4wifi`. Automated tests exercise puzzle rules, completed-trial rewards, timing, pause/reconnect behavior, and Bluetooth packets. Actual dispensing requires verification on the tablet and pump.

## Vercel

Live game: **https://churchland-block-fit.vercel.app/**

The `churchland-block-fit` project belongs to the **Churchland Lab** Vercel team. Its dashboard is https://vercel.com/churchland-lab/churchland-block-fit. The connected GitHub repository is https://github.com/mtthwcorn/churchland-block-fit.

The root `vercel.json` specifies the build, test command, and `dist/` output. There are no environment variables, database, server functions, or application secrets. The game opens at the site's root URL.

The production branch is `main`. Vercel's GitHub integration publishes updates after tests pass. Keep credentials and the local `.vercel/` directory out of Git.

## Lab handoff

The GitHub repository can be transferred from the current personal owner to a lab maintainer through GitHub's repository settings. Vercel project ownership is separate. After a transfer, verify Vercel's repository connection, permissions, and production deployment with the new owner.
