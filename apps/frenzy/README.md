# Four-Leg Frenzy

A comedic four-limb locomotion physics challenge. Pilot the **Wobblebeest** — a
barrel-bodied, big-eyed quadruped — down a sunny 50 m pasture by manually
swinging and stomping each of its four legs. Good rhythm builds speed; bad
rhythm pitches the poor beast face-first into the grass.

## How to play

Each leg is a button. **Hold** a leg to swing it forward, **release** to drop
it — when it lands it stomps, kicking the body forward. The fastest gait is an
alternating diagonal trot: **FL+BR together, then FR+BL together**, over and
over. Mashing legs on the same side pitches the body; past ~35° you stumble,
past ~80° you wipe out (falls cost time).

- **Race 50 m** — finish as fast as you can inside 90 s. Falls add a 3 s
  penalty. Ranks: S ≤ 30 s, A ≤ 45 s, B ≤ 65 s, otherwise C (effective time
  includes penalties). Best race is saved.
- **Training** — same physics, no clock, endless pasture.

### Controls

| Leg | Touch | Keys |
| --- | --- | --- |
| Front-left | FL button (top-left) | `Q` or `A` |
| Front-right | FR button (top-right) | `W` or `S` |
| Back-left | BL button (bottom-left) | `O` or `K` |
| Back-right | BR button (bottom-right) | `P` or `L` |

Buttons support simultaneous multi-touch presses. Key hints hide automatically
once touch is used. Gear icon opens settings (reduced camera motion, SFX).

## Physics model

Pure TypeScript simulation (`src/sim/`), no DOM, fully deterministic:

- **Fixed timestep** — 120 Hz accumulator fed from `requestAnimationFrame`;
  rendering and input never influence integration.
- **Seeded PRNG** — mulberry32 state lives inside the sim state, so identical
  scripts replay identically.
- **Body** — point mass with spring height control (stiffness scales with the
  number of planted legs) and a pitch degree of freedom with restorative
  stiffness, damping, and a speed-proportional rhythmic wobble when
  under-supported.
- **Legs** — a state machine per leg: `planted → swing (held) → drop
  (released) → planted`. On plant, the body gains forward impulse proportional
  to the swung arc, a counter-torque (front legs pitch up, back legs pitch
  down — diagonal pairs cancel), and a small hop.
- **Stumble / fall** — pitch beyond the stumble threshold costs speed and a
  fall count; beyond the flip threshold the run resets 2 m back with a 3 s
  penalty. Recovery is automatic — the game can never soft-lock (held legs
  auto-drop, belly-down legs scramble, restorative pitch torque never
  vanishes).

Rendering (`src/render/renderer.ts`) is 100 % procedural Canvas 2D — no image
assets. Audio (`src/audio.ts`) is synthesized WebAudio, unlocked on first
gesture and gated by the host's audio-enabled state.

## Development

All commands run from this directory using workspace binaries:

```sh
../../node_modules/.bin/vite          # dev server
../../node_modules/.bin/tsc --noEmit  # typecheck
../../node_modules/.bin/vitest run    # sim unit tests
../../node_modules/.bin/vite build    # production build -> dist/
```

## Testing

`src/sim/sim.test.ts` covers: determinism (same scripted inputs → identical
final state), impulse and counter-torque sanity per leg, diagonal-pair speed
and pitch stability, stumble/flip thresholds, 10 000 random seeded steps
without NaN, anti-soft-lock recovery, belly-flop exploit regression, finish
detection at 50 m, competent-rhythm completion, and timeout.
