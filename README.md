# Icarus Games

A monorepo of small, original casual games built to ship on three surfaces from one codebase:

- **YouTube Playables** (web build + Playables SDK)
- **Android** (Capacitor shell)
- **iOS** (Capacitor shell)

## Games

| App | Package | Game | Tech |
| --- | --- | --- | --- |
| `apps/swirl` | `@icarus/swirl` | **Swirl!** — soft-serve stacking: hold to dispense, keep it neat, don't topple | Three.js, continuous spiral tube mesh |
| `apps/fold` | `@icarus/fold` | **Fold** — calm origami puzzler, 30 levels, real polygon folding | Canvas 2D + custom geometry engine (reflection, Sutherland–Hodgman clip, ear-clip triangulation) |
| `apps/frenzy` | `@icarus/frenzy` | **Four-Leg Frenzy** — QWOP-style 4-limb locomotion race, 50 m in 90 s | Canvas 2D, 120 Hz fixed-timestep deterministic physics |
| `apps/tissue` | `@icarus/tissue` | **Tissue Rush** — time-attack: empty a tissue box with upward swipes | Canvas 2D, verlet cloth ribbon |

`packages/platform` (`@icarus/platform`) is the shared host adapter: it detects the
YouTube Playables environment (`window.ytgame`), and provides `ready()`,
`load()/save()` (Playables data API with `localStorage` fallback on web),
`sendScore()`, lifecycle pause/resume binding, host audio-state tracking and
error reporting. Every game consumes it as TypeScript source.

## Setup

```bash
npm install        # once, at the root — installs all workspaces
```

> **Node 24+ is required for the Capacitor CLI** (it loads each app's
> `capacitor.config.ts` via native type stripping). Vite/Vitest work on older
> Node, but `cap add` / `cap sync` will fail on Node < 22.6 without
> `--experimental-strip-types`.

## Develop

```bash
npm run dev:swirl      # or dev:fold / dev:frenzy / dev:tissue
```

Vite dev server with hot reload; the game runs in plain-web mode
(`localStorage` persistence, no Playables host calls).

## Quality gates (run before shipping)

```bash
npm run typecheck    # tsc --noEmit across all workspaces
npm run test         # vitest across all games (136 tests)
npm run build        # vite build across all games -> apps/<game>/dist
```

Each game's vitest suite covers its pure core (geometry engine and all-30-level
solution replay for Fold, physics determinism for Frenzy, round state machine
for Tissue Rush, scoring/wobble for Swirl) — no DOM required.

## YouTube Playables

- `vite.config.ts` uses `base: './'` so the bundle works from any host path.
- Each `index.html` loads `https://www.youtube.com/game_sdk/v0` in `<head>`
  (the only external request; failure is handled gracefully).
- No external runtime asset fetches, ads, analytics or IAP — all art is
  procedural and all SFX are WebAudio-synthesized (unlocked on first gesture,
  muted when the host disables audio or pauses the game).
- Initial bundles are small (≈9–144 kB gzipped per game).

To verify a production build locally:

```bash
npm run build
python3 -m http.server 8100
# open http://localhost:8100/apps/<game>/dist/index.html
```

## Android & iOS (Capacitor)

Each app has `capacitor.config.ts` (`webDir: 'dist'`, app id
`com.icarusgames.<game>`) and scripts:

```bash
cd apps/<game>
npm run build          # produce dist first
npx cap add android    # scaffold native shells (already done, committed)
npx cap add ios
npx cap sync           # copy dist into the native shells
npx cap open android   # Android Studio
npx cap open ios       # Xcode (requires CocoaPods: pod install runs via sync)
```

Native shells live in `apps/<game>/android` and `apps/<game>/ios`. Build
artifacts (Gradle output, Pods, DerivedData) are git-ignored.

## Repository layout

```
apps/
  swirl/  fold/  frenzy/  tissue/     # the four games (Vite + TS + Capacitor)
packages/
  platform/                           # @icarus/platform shared host adapter
```

## Out of scope (handled separately)

Onboarding, paywalls, pricing and store/monetization flows are intentionally
not part of these game builds.
