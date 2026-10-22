# Tissue Rush

A fast, tactile tissue-pulling time-attack. Grab each tissue sticking out of
the box, swipe UP, and rip it free — empty the whole box as quickly as you
can. No fail states, pure speed: the clock starts on your first grab and
stops the instant the last tissue leaves the box.

## How a round works

- **Menu** — pick a round size: 25, 50 or 100 tissues. Your best (shortest)
  time per size is shown and persisted.
- **Countdown** — a 3-2-1-GO readies you; the first tissue is already up, but
  the timer only starts on your first grab, so take your time aiming.
- **Play** — pointer down ON the exposed tissue grabs it; drag upward and the
  tissue follows your finger as a soft cloth ribbon (~10 verlet points). A
  tension meter beside the box shows the perforation stretching:
  - release **past** the stretch point → the tissue rips free and flies off
    with your release velocity (spin + gravity, off-screen), then the next
    tissue pops up with a bounce;
  - release **below** it → the tissue snaps back into the box and does NOT
    count.
- **Streaks** — consecutive pulls under 450 ms apart pop "Speedy!", under
  250 ms "Blazing!".
- **Results** — total time (mm:ss.t), average per tissue, round size, and a
  BEST badge when you beat your record, plus a confetti burst. Replay jumps
  straight back into the same size.

## Architecture notes

- **Pure core** (`src/core/`, node-testable, no DOM): `round.ts` is the round
  state machine (`idle → grabbing → pulling → flying → next → finished`) with
  an injectable clock, threshold accept/reject, streak tiers and timer math;
  `save.ts` owns the persisted shape
  `{ v: 1, bestMs: { 25, 50, 100 } }` and best-time updates.
- **DOM side** (`src/game/`, `src/ui/`): Canvas 2D renderer (all art is
  procedural — gradient sky, bubbles, pastel polka-dot box, wavy sheets,
  cloth ribbon, flyers, confetti), pointer input with release-velocity
  tracking, WebAudio-synthesized sfx (rustle/pop/whoosh/chime), and a small
  DOM overlay UI. `src/main.ts` glues everything to the shared
  `@icarus/platform` adapter (ready, lifecycle pause/resume, load/save,
  score, error reporting).
- The game clock only advances while unpaused, so pausing freezes the timer
  fairly and mutes audio.
- Audio starts after the first user gesture and follows the host's
  `isAudioEnabled()` state.

## Dev / build

From the repo root:

```sh
npm run dev -w @icarus/tissue      # vite dev server
npm run build -w @icarus/tissue    # production build -> dist/
npm run test -w @icarus/tissue     # vitest (pure core)
npm run typecheck -w @icarus/tissue
```

Or from this directory: `npm run dev`, `npm run build`, `npm run test`,
`npm run typecheck` (binaries resolve via the root `node_modules`).
