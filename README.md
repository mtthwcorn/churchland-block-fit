# Churchland Block Fit

A simple touchscreen puzzle for Android tablets running Chrome. Three pieces fit into a square. Drag a piece into its matching space, or tap the piece and then the space. Completed puzzles start another trial automatically.

## Juice rewards

Each tablet connects directly over Bluetooth to its own Arduino UNO R4 WiFi and pump using the existing Eric Pump firmware. No pump requests go through a cloud server.

- The game opens in practice mode and never starts the motor on load or connection.
- Connect the pump, enter **mL per trial**, and select **Start with juice**.
- Juice runs **once, only after all three blocks fit**. Blocks one and two dispense nothing.
- The fixed rate is **90 mL/min (1.5 mL/s)**. For example, 1.5 mL per trial produces a one-second command. Displayed volume is an estimate, not measured flow.
- Pause stops the pump and allows editing the amount. Resume is explicit.
- The firmware accepts 0.1–60-second pulses, corresponding to 0.15–90 mL per trial.
- Hidden pages, lost connections, and failed pulses pause reward play. Interrupted rewards never replay automatically.
- The next trial waits until the pump has stopped. There is no accumulating reward queue.

Use trusted HTTPS on the tablets for Bluetooth access. The game caches itself for offline use after a successful visit; offline availability depends on the browser retaining its cache. Reopening still starts in practice mode. There is no calibration screen or session limit.

## Development

Use Node.js 22. No third-party JavaScript packages are required.

```sh
npm ci
npm test
npm run build
python3 -m http.server 8765 --directory dist
```

Open `http://localhost:8765/`. The build produces a standalone static site in `dist/`. Automated tests exercise puzzle rules, completed-trial rewards, timing, pause/reconnect behavior, and Bluetooth packets. Actual dispensing requires verification on the tablet and pump.

## Vercel

Import this repository into the Churchland Lab Vercel account. The root `vercel.json` specifies the build, test command, and `dist/` output. There are no environment variables, database, server functions, or application secrets. The game opens at the site's root URL.

The production branch is `main`. Once Vercel's GitHub connection is configured, pushing to `main` publishes updates after tests pass. Keep credentials and the local `.vercel/` directory out of Git.

## Lab handoff

The GitHub repository can be transferred from the current personal owner to a lab maintainer through GitHub's repository settings. Vercel project ownership is separate. After a transfer, verify Vercel's repository connection, permissions, and production deployment with the new owner.
