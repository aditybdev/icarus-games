# Swirl!

A 3D soft-serve ice-cream swirl simulator built with Three.js. Guide your
waffle cone under the dispenser, press and hold to extrude a continuous
spiral of soft-serve, and stack it as tall and neat as you can — drift too
far off-center and the whole thing topples over.

Everything is procedural: the waffle crosshatch is drawn on a canvas, the
swirl is a single tube mesh extruded along a growing Archimedean-ish spiral
curve (never stacked rings), and all sound effects are synthesized with
WebAudio. No image, font, or audio assets.

## Controls

- **Drag / move mouse** — slide the cone left and right under the nozzle
  (Arrow keys or A/D also steer).
- **Press and hold** (pointer held down, or Space) — dispense soft-serve.
  Release to stop.
- Dispensing off-center builds up **wobble** (watch the meter). Dispensing
  near the nozzle recovers it. If the wobble gets too big for the swirl's
  height, it topples.

## Modes

- **Free Swirl** — grow as tall as possible. Score = height points plus a
  neatness bonus (up to +500 for a steady hand). Ends when you press
  **Done**, hit max height, or the swirl topples.
- **Order Rush** — 3 sequential orders. Each order has a target height band
  and a flavor (vanilla / strawberry / mint / chocolate — pick it with the
  flavor buttons). Earn 1–3 stars per order for height accuracy; the wrong
  flavor caps you at 1 star; a toppled order earns 0. Total stars (out of 9)
  is your result.

Best Free Swirl score and best Order Rush stars are persisted.

## Development

From this directory:

```sh
npm run dev        # vite dev server
npm run build      # production build -> dist/
npm run preview    # preview the build
npm run typecheck  # tsc --noEmit
npm run test       # vitest run (pure logic: scoring, stars, wobble, save)
```

Or from the monorepo root:

```sh
npm run dev:swirl
```

## Platform notes

- `index.html` loads the YouTube Playables SDK
  (`https://www.youtube.com/game_sdk/v0`) before the game module. All access
  goes through the shared `@icarus/platform` adapter, which guards every
  call — the game works fine when the SDK is absent (offline dev, plain
  web): saves fall back to `localStorage`, lifecycle to `visibilitychange`.
- The adapter is used for `ready()` after the first frame, pause/resume
  lifecycle (the loop halts and audio mutes on pause), versioned save/load
  (`{ v, best, bestOrderStars }`), `sendScore()` on the results screen,
  audio-enabled state, and `reportError()` from window error handlers.
- Native wrappers: `npm run cap:add` once, then `npm run cap:sync` builds
  the web bundle and syncs the Capacitor android/ios projects.
