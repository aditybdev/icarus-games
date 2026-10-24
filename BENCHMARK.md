# Icarus Market Benchmark — The Bar for Every Game

Acceptance gate for all Icarus games (shipped + new). Every criterion is
cloned from what proven market winners ship — "copy and clone and cheat, do
whatever works." Sources at the bottom; full research trail (ephemeral):
`/tmp/icarus-ideas/market-quality-bar.md` (44 citations), `catalog-gaps.md`,
`retention-mechanics.md`.

How to read this file:
- **[M]** = market-proven: directly observed in a cited winner or platform gate.
- **[I]** = inference: derived from cited market evidence.
- **GATE 1 (hard fail):** any failed [M] criterion blocks shipping.
- **GATE 2:** ≥80% of [I] criteria per category; a failed [I] needs a written
  counter-argument citing market evidence.
- **Score:** 1 point per passed criterion → "Market Bar: X/29", evidence
  (measurement method + observed value) recorded per game.

## 1 Physics (7)

| # | Criterion | | Evidence base |
|---|-----------|-|---------------|
| P1 | Real simulation for anything labeled physics — rigid-body/verlet/constraints, bounce-roll-settle under gravity; zero scripted trajectories for player-facing physics | M | Suika/Fruit Merge Box2D, Drive Mad, ragdoll winners |
| P2 | Frame-rate independent: fixed-timestep sim + render interpolation; same inputs → same outcome class at 30/60/120fps | M | Suika-clone retune; Fiedler fixed-step |
| P3 | Tactile tuning floor: dropped object bounces once then settles; walls have friction; full settle ≤0.5s after rest contact | M | Suika-clone dev tuning targets |
| P4 | Fail = spectacle: crashes produce the game's best physics moment, never a silent reset | I | Drive Mad crash loop, ragdoll damage scoring |
| P5 | Juice minimum on every major impact/goal: hit-stop 60–90ms + volume-preserving squash ≤0.45s + particle burst (10–20, ≤1s) + SFX pitch ±4%; screen shake 0.1–0.6s w/ rotation on tier-3+ events only | M | web game-feel teardown parameters |
| P6 | Chaos statistically fair: no win→loss flips attributable to device frame rate; precision modes fully deterministic | M | Level Devil fairness contract |
| P7 | Daily mode deterministic from seed: same date → identical sequence on every device | I | daily-cadence + seeded-RNG evidence |

## 2 UI / HUD (8)

| # | Criterion | | Evidence base |
|---|-----------|-|---------------|
| U1 | Persistent HUD ≤3 elements during play (score + progress + one status); everything else on pause/results | M | Suika 3, Drive Mad ~0, Level Devil 2 |
| U2 | Tap targets ≥44×44 CSS px; primary input zone ≥25% of screen; adjacent targets ≥8px apart | M | iOS HIG/Material/WCAG floor; Drive Mad zones |
| U3 | First interaction ≤5s from `gameReady`; onboarding ≤10s, ≤10 words, zero tutorial screens — teach inside play | M | mediacube ≤10s, Voodoo, Meta <5s gate |
| U4 | One-finger, one-handed ("bus test"): no simultaneous inputs, no precision-drag under motion | M | Voodoo, mediacube one-finger rule |
| U5 | Results screen: run score largest; best/next-threshold delta; medal earned; ONE dominant replay CTA ≥48px; restart ≤1 tap | M | hyper-casual canonical structure |
| U6 | ≤1 menu screen between load and gameplay; dominant primary CTA; ≤3 secondary actions | I | named-winner menu pattern |
| U7 | Correct at 1:1, 16:9, 9:16; portrait primary; legible/bright per cert language | M | Playables cert |
| U8 | Mute persisted; `prefers-reduced-motion` honored (no shake/flash/particles) | M | cert mute rule + juice-a11y |

## 3 Scoring / progression (8)

| # | Criterion | | Evidence base |
|---|-----------|-|---------------|
| S1 | 3-tier threshold ladder per mode (bronze/silver/gold) on top of raw score; thresholds fixed, honest | M | 3-tier market convention |
| S2 | Tier calibration: bronze ≤2 runs median; silver ≈3-attempt difficulty; gold = top-decile, NOT median without practice. Spacing ≈30/60/85–90% of max achievable | I | 3.2-attempts/level empirical anchor (arXiv) + spacing heuristic |
| S3 | Round length 30–90s; session chains 3–6 rounds ≈3–6 min; daily mode = 5-min anchor | M | winner round lengths + GameAnalytics medians |
| S4 | Restart <500ms fail→playable; fail-forward (score/progress/deltas kept on loss) | M | Drive Mad one-click, Level Devil quick respawn |
| S5 | Ramp: first 5 stages ≥90% first-try; one new mechanic per 2–3 stages; steady state = median success attempt 2–4; difficulty = speed×density×complexity | M | Level Devil cadence, arXiv steady state |
| S6 | Near-miss delta at every fail: exact gap to next threshold ("74 pts from Gold", "0.3s from best") | M | near-miss evidence; Screw Master monetizes fail moments |
| S7 | Endowed progress: every meta-track starts visibly non-empty (first medal/unlock in session 1); ≥1 "almost complete" track always visible | M | endowed-progress + goal-gradient |
| S8 | Design supports ~10 min average daily playtime via sessions/day chaining, not single long runs | M | platform guidance + GA medians |

## 4 Technical (6 of 8 [M])

| # | Criterion | | Evidence base |
|---|-----------|-|---------------|
| T1 | Initial bundle <30MB pre-`gameReady` (hard gate); ship target ≤10MB → first load <5s on 4G | M | YT cert + Meta <5MB/<5s gate |
| T2 | First interactive ≤5s on 4G mid-tier; `gameReady` only when playable; `firstFrameReady` when visuals appear | M | Meta gate + cert |
| T3 | 60fps sustained on 5-year-old Android-class device under worst-case load; drops only at scene transitions; zero long tasks >50ms in gameplay | M | Playgama review bar; Suika-clone test floor |
| T4 | Zero per-frame allocations in the hot loop (pooled entities; no per-frame DOM churn) | I | 60fps requirement + performance guidance |
| T5 | Pause halts rendering+audio+gameplay instantly; mute instant, not in-game-overridable | M | cert |
| T6 | Cert-trap safe: renders from zero viewport; no audio pre-gesture; CSP-nonce compliant; zero external calls; all data in bundle | M | cert FAQ |
| T7 | Crash-free sessions >98%; zero console errors in a 30-min session | M | Meta >98% gate |
| T8 | Saves via platform local storage ≤3MiB, aggregates only (medals/PBs/streaks), no event logs | M | platform storage rule |

## Measurement methods

- Load: 4G-throttled trace on Moto G-class profile (or 4× CPU + Slow 4G in devtools).
- FPS: 60s worst-case trace on 5-yr-old device or 4× CPU throttle.
- Restart latency: timestamped fail→input-responsive.
- Onboarding: fresh-user stopwatch to first meaningful input; count words shown.
- Medal calibration: ≥10 first-session playtests bucketed by skill; re-derive
  percentile targets from the game's own distribution once data exists —
  market data sets the shape, the game's data sets the numbers.

## Scores

Market Bar = X/29. "verified" = measured with method above; "pending" = not
yet measured on a representative device (host iGPU saturation makes local fps
noise-only — trust longtasks/heap + 4× throttle runs).

| Game | Physics | UI | Scoring | Tech | Total | Notes |
|------|---------|----|---------| ---- |-------|-------|
| Swirl | verified P1,P2,P4-P7 | verified U1-U8 | verified S1-S3,S6-S8 | verified T1,T2,T4-T8 | — | T3 pending device trace; S4/S5 n/a (endless pour, no levels); turbo overdrive live-verified 2026-10-24 |
| Fold | verified P1,P2,P6,P7 | verified U1-U8 | verified S1-S7 | verified T1,T2,T4-T8 | — | T3 pending; P3-P5 physics-juice n/a (geometry puzzle); S8 via daily |
| Four-Leg Frenzy | verified P1-P7 | verified U1-U8 | verified S1-S8 | verified T1,T2,T4-T8 | — | T3 pending; rank ladder S/A/B/C = 3-tier+ |
| Tissue Rush | verified P1-P7 | verified U1-U8 | verified S1-S8 | verified T1,T2,T4-T8 | — | T3 pending; medal attainability math proven 2026-10-24 |
| Skim | — | — | — | — | /29 | acceptance record at ship |
| Tap the 57 | — | — | — | — | /29 | acceptance record at ship |
| Golden Mallow | — | — | — | — | /29 | acceptance record at ship |
| Pop the Lid | — | — | — | — | /29 | acceptance record at ship |

n/a criteria are excluded from that game's denominator with the reason noted.

## Sources (primary)

Drive Mad: fancade.com (300M+ plays), play.google.com/store/apps/details?id=com.martinmagni.drivemad, gamesfree.io/game/drive-mad (instant restart), accelerationcity.cc/game/drive-mad (two-zone controls).
Suika/merge: en.wikipedia.org/wiki/Suika_Game, stay-foolish-capital.com (Box2D dev teardown + tuning targets + 5-yr test floor), phaser.io/news/2024/10/suika-watermelon-game-source.
Ragdoll: playgama.com/blog/top-games/top-ragdoll-games-april-2026 ("60fps no lag" review bar, 30s–2min levels, damage ladders).
Level Devil: trollplatform.io, play.google.com (quick respawns), github.com/Leonxlnx/level-devil (trap cadence, deterministic movement).
WeChat: pocketgamer.biz (Screw Master 3D: monetize failures, D30 12h playtime), superpixel.com (Sheep a Sheep 0.09% wall).
Juice: valdemird.com/blog/game-feel-on-the-web (hit-stop 60–90ms, squash 0.42s, 14-particle bursts, ±4% pitch), egmatic.com, gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design.
UI: appetiteui.com / m3.material.io (44px/48dp), mediacube.io (≤10s onboarding, one-finger), gameanalytics.com Voodoo guide.
Scoring: arxiv.org/html/2401.17436v1 (3.2 attempts/level steady state), reddit r/gamedesign 30/60/85–90% spacing, GameAnalytics 2026 benchmarks (session 3.1–3.5min median, P90 ~8min, 3.9 sessions/day, ~12min daily).
Tech: developers.google.com/youtube/gaming/playables/support/certification_faq (cert traps), wiki.playgama.com/platforms/youtube-playables-requirements-for-games + playables.in (<30MB, pause/mute, aspect ratios), wiki.playgama.com/playgama/guides/platform-launch (Meta <5s/4G, >98% crash-free, <5MB).
