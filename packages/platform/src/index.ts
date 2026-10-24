/**
 * Shared platform adapter for Icarus Games.
 * Detects the YouTube Playables host SDK and exposes a uniform API for
 * readiness, lifecycle (pause/resume), save/load, score submission and
 * audio-state changes. Falls back to plain web behavior (localStorage,
 * visibilitychange) when not running inside YouTube Playables.
 */

export interface YtGameSdk {
  IN_PLAYABLES_ENV?: boolean;
  game?: {
    firstFrameReady?: () => void;
    gameReady?: () => void;
    loadData?: () => Promise<string | null | undefined>;
    saveData?: (data: string) => Promise<void> | void;
  };
  engagement?: {
    sendScore?: (score: { value: number }) => void;
  };
  health?: {
    /** Host health channel — takes no parameters (host infers context). */
    logError?: () => void;
    logWarning?: () => void;
  };
  system?: {
    getLanguage?: () => Promise<string>;
    isAudioEnabled?: () => boolean;
    onAudioEnabledChange?: (cb: (enabled: boolean) => void) => void;
    onPause?: (cb: () => void) => void;
    onResume?: (cb: () => void) => void;
  };
}

declare global {
  interface Window {
    ytgame?: YtGameSdk;
  }
}

export type PlatformKind = 'playables' | 'web';

export interface LifecycleHandlers {
  pause: () => void;
  resume: () => void;
  /**
   * Return true while the current pause was initiated by the user (pause
   * button / overlay) rather than the host. A host or visibility resume will
   * never dismiss a user-chosen pause — the game resumes only via its own UI.
   */
  isManualPause?: () => boolean;
}

export class Platform {
  readonly kind: PlatformKind;
  private readonly storageKey: string;

  constructor(readonly gameId: string) {
    this.kind =
      typeof window !== 'undefined' && window.ytgame?.IN_PLAYABLES_ENV
        ? 'playables'
        : 'web';
    this.storageKey = `icarus:${gameId}:save`;
  }

  get isPlayables(): boolean {
    return this.kind === 'playables';
  }

  /** Call once the first frame has rendered and the game is interactive. */
  async ready(): Promise<void> {
    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
    if (!yt?.IN_PLAYABLES_ENV) return;
    try {
      yt.game?.firstFrameReady?.();
    } catch {
      /* host not initialized (local dev) */
    }
    try {
      yt.game?.gameReady?.();
    } catch {
      /* host not initialized (local dev) */
    }
  }

  /** Load saved progress. Returns `fallback` when nothing is stored. */
  async load<T>(fallback: T): Promise<T> {
    if (this.isPlayables) {
      try {
        const raw = await window.ytgame?.game?.loadData?.();
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as T;
        return parsed ?? fallback;
      } catch {
        return fallback;
      }
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return fallback;
      return (JSON.parse(raw) as T) ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Persist progress (JSON-serializable, keep well under 3 MB). */
  async save(value: unknown): Promise<void> {
    if (this.isPlayables) {
      try {
        await window.ytgame?.game?.saveData?.(JSON.stringify(value));
      } catch (error) {
        console.warn('[platform] Playables save failed', error);
      }
      return;
    }
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode etc.) */
    }
  }

  /** Submit a score to the YouTube leaderboard (no-op elsewhere). */
  sendScore(value: number): void {
    try {
      window.ytgame?.engagement?.sendScore?.({ value: Math.round(value) });
    } catch {
      /* unsupported host */
    }
  }

  /**
   * Bind pause/resume to the host. In Playables this uses the SDK lifecycle;
   * on the open web it maps to document visibility. Games must mute audio and
   * halt simulation on pause.
   */
  bindLifecycle({ pause, resume, isManualPause }: LifecycleHandlers): void {
    let paused = false;
    const safePause = () => {
      if (paused) return;
      paused = true;
      pause();
    };
    const safeResume = () => {
      if (!paused) return;
      paused = false;
      if (isManualPause?.()) return;
      resume();
    };
    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
    if (yt?.IN_PLAYABLES_ENV) {
      try {
        yt.system?.onPause?.(safePause);
        yt.system?.onResume?.(safeResume);
      } catch (error) {
        console.warn('[platform] lifecycle binding failed', error);
      }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) safePause();
      else safeResume();
    });
  }

  /** Current host audio state (Playables can mute game audio system-wide). */
  isAudioEnabled(): boolean {
    try {
      return window.ytgame?.system?.isAudioEnabled?.() ?? true;
    } catch {
      return true;
    }
  }

  /** Subscribe to host audio-state changes. */
  onAudioEnabledChange(cb: (enabled: boolean) => void): void {
    try {
      window.ytgame?.system?.onAudioEnabledChange?.(cb);
    } catch {
      /* unsupported host */
    }
  }

  /** Report a non-fatal error to the host health channel. */
  reportError(errorType: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    try {
      // The host health API takes no parameters — it infers context itself.
      window.ytgame?.health?.logError?.();
    } catch {
      /* unsupported host */
    }
    // Production builds must stay console-clean for the cert bar; the host
    // health channel above is the reporting path. Log only in dev.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      console.error(`[platform] ${errorType}:`, error);
    }
  }
}

export function createPlatform(gameId: string): Platform {
  return new Platform(gameId);
}

/* --------------------------------------------------------------------------
 * Shared helpers — one implementation for all four games.
 * ------------------------------------------------------------------------ */

let hapticsEnabled = true;

/** Global haptics on/off (wired to the game's settings toggle). */
export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

/**
 * Guarded vibration: a no-op on iOS/desktop, free juice on Android.
 * Best-effort only — some webviews throw, and that's fine.
 */
export function haptics(pattern: number | number[]): void {
  if (!hapticsEnabled) return;
  // Chrome logs a console error when vibrate fires before any real gesture —
  // stay silent until the user has actually tapped.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported webview */
  }
}

/** True when the OS asks for reduced motion (safe default: false). */
export function osPrefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

const hookedGameIds = new Set<string>();

/**
 * Route uncaught errors and unhandled rejections to the host health channel.
 * Call once, as early as possible in main.ts (before constructing anything
 * that could throw) so constructor failures are reported too. Idempotent.
 */
export function installErrorHooks(platform: Platform, gameId: string): void {
  if (typeof window === 'undefined' || hookedGameIds.has(gameId)) return;
  hookedGameIds.add(gameId);
  window.addEventListener('error', (e) => {
    platform.reportError(gameId, e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    platform.reportError(gameId, e.reason ?? 'unhandled rejection');
  });
}

/** mulberry32 — tiny deterministic PRNG shared by dailies and sims. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic uint32 seed from a UTC calendar date (for Icarus Daily). */
export function dateSeedUTC(date: Date = new Date()): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return ((y * 10000 + m * 100 + d) * 2654435761) >>> 0;
}

/* --------------------------------------------------------------------------
 * Icarus Daily — UTC date keys + streak math, shared by all four games.
 * ------------------------------------------------------------------------ */

/** 'YYYY-MM-DD' key for a UTC date (today by default). */
export function dailyKeyUTC(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day before a 'YYYY-MM-DD' key, in the same format. */
export function prevDailyKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dailyKeyUTC(d);
}

export interface DailyProgress {
  /** Last day a daily was completed ('YYYY-MM-DD'), or '' for never. */
  dailyLast: string;
  /** Consecutive-day completion streak. */
  dailyStreak: number;
}

/**
 * Fold a completed daily into the progress. Same-day replays leave the
 * streak untouched; a next-day completion extends it; anything older
 * restarts it at 1.
 */
export function recordDailyCompletion(
  progress: DailyProgress,
  todayKey: string,
): DailyProgress {
  if (progress.dailyLast === todayKey) return { ...progress };
  const streak =
    progress.dailyLast === prevDailyKey(todayKey) ? progress.dailyStreak + 1 : 1;
  return { dailyLast: todayKey, dailyStreak: Math.max(1, streak) };
}

/** True when today's daily is already completed. */
export function dailyDoneToday(progress: DailyProgress, todayKey: string): boolean {
  return progress.dailyLast === todayKey;
}

/* --------------------------------------------------------------------------
 * defineSave — versioned save definitions with total normalization.
 *
 * Policy (portfolio-wide):
 * - Every payload carries `v`. normalize() NEVER throws: garbage → defaults.
 * - `sanitize` coerces a current-version payload field by field (game-owned).
 * - `migrate(raw, fromVersion)` is a pure step that must return the payload
 *   upgraded to the current version; it runs when v < version.
 * - Forward tolerance: when v is NEWER than this build (a cached old bundle
 *   reading a newer save), known fields are sanitized and unknown top-level
 *   fields — including the newer `v` stamp — are preserved verbatim so the
 *   next save doesn't silently strip the future build's data.
 * ------------------------------------------------------------------------ */

export interface SaveDefinition<S> {
  version: number;
  defaults: S;
  sanitize: (raw: Record<string, unknown>) => S;
  migrate?: (raw: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
}

export interface SaveHandle<S> {
  normalize(raw: unknown): S;
}

function deepCopy<S>(value: S): S {
  return JSON.parse(JSON.stringify(value)) as S;
}

export function defineSave<S>(def: SaveDefinition<S>): SaveHandle<S> {
  return {
    normalize(raw: unknown): S {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return deepCopy(def.defaults);
      let payload = raw as Record<string, unknown>;
      const v = typeof payload.v === 'number' && Number.isFinite(payload.v) ? payload.v : 0;
      if (v < def.version && def.migrate) {
        try {
          payload = def.migrate(payload, v);
        } catch {
          return deepCopy(def.defaults);
        }
      }
      const clean = def.sanitize(payload);
      if (v > def.version) {
        // Newer save than this build: preserve unknown fields + the version stamp.
        const out = clean as Record<string, unknown>;
        const known = new Set(Object.keys(def.defaults as object));
        for (const key of Object.keys(payload)) {
          if (key !== 'v' && !known.has(key)) out[key] = payload[key];
        }
        out.v = v;
      }
      return clean;
    },
  };
}

/* --------------------------------------------------------------------------
 * Icarus profile — cross-game identity (settings + per-game mastery).
 *
 * Storage reality: Playables saveData is per-game and host-scoped — no
 * cross-game channel exists there. The shared profile lives under the
 * localStorage key `icarus:profile`, which only aggregates when several
 * Icarus games are served from ONE origin (web/arcade shell). Every game
 * also merges the fragment it can see, so per-game views stay correct
 * everywhere and same-origin web gets the full portfolio view.
 * ------------------------------------------------------------------------ */

export interface ProfileSettings {
  sfx: boolean;
  haptics: boolean;
  reducedMotion: boolean;
}

export interface GameProfileEntry {
  plays: number;
  /** ISO date of the last session ('YYYY-MM-DD'). */
  lastPlayed: string;
  /** Mastery 0–1000 computed from that game's persisted bests. */
  mastery: number;
}

export interface IcarusProfile {
  v: 1;
  settings: ProfileSettings;
  games: Record<string, GameProfileEntry>;
}

export const PROFILE_STORAGE_KEY = 'icarus:profile';

export function defaultProfile(): IcarusProfile {
  return {
    v: 1,
    settings: { sfx: true, haptics: true, reducedMotion: osPrefersReducedMotion() },
    games: {},
  };
}

/** Total coercion of an unknown persisted profile. */
export function normalizeProfile(raw: unknown): IcarusProfile {
  const profile = defaultProfile();
  if (!raw || typeof raw !== 'object') return profile;
  const data = raw as Partial<IcarusProfile>;
  if (data.settings && typeof data.settings === 'object') {
    const s = data.settings as Partial<ProfileSettings>;
    if (typeof s.sfx === 'boolean') profile.settings.sfx = s.sfx;
    if (typeof s.haptics === 'boolean') profile.settings.haptics = s.haptics;
    if (typeof s.reducedMotion === 'boolean') profile.settings.reducedMotion = s.reducedMotion;
  }
  if (data.games && typeof data.games === 'object') {
    for (const [id, entry] of Object.entries(data.games)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Partial<GameProfileEntry>;
      profile.games[id] = {
        plays:
          typeof e.plays === 'number' && Number.isFinite(e.plays) && e.plays > 0
            ? Math.floor(e.plays)
            : 0,
        lastPlayed: typeof e.lastPlayed === 'string' ? e.lastPlayed : '',
        mastery:
          typeof e.mastery === 'number' && Number.isFinite(e.mastery)
            ? Math.max(0, Math.min(1000, Math.round(e.mastery)))
            : 0,
      };
    }
  }
  return profile;
}

/** Read the shared profile key (web storage only; returns defaults elsewhere). */
export function loadSharedProfile(): IcarusProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    return normalizeProfile(raw ? JSON.parse(raw) : undefined);
  } catch {
    return defaultProfile();
  }
}

/** Persist the shared profile key (no-op when storage is unavailable). */
export function saveSharedProfile(profile: IcarusProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Merge two profile views (e.g. a game's embedded fragment with the shared
 * key). Settings prefer `local` (this device's explicit toggles win); game
 * entries union with max plays (a mirrored entry must not double-count),
 * latest lastPlayed and max mastery.
 */
export function mergeProfiles(local: IcarusProfile, shared: IcarusProfile): IcarusProfile {
  const merged: IcarusProfile = { v: 1, settings: { ...local.settings }, games: {} };
  for (const id of new Set([...Object.keys(local.games), ...Object.keys(shared.games)])) {
    const a = local.games[id];
    const b = shared.games[id];
    if (a && b) {
      merged.games[id] = {
        plays: Math.max(a.plays, b.plays),
        lastPlayed: a.lastPlayed > b.lastPlayed ? a.lastPlayed : b.lastPlayed,
        mastery: Math.max(a.mastery, b.mastery),
      };
    } else {
      merged.games[id] = { ...(a ?? b)! };
    }
  }
  return merged;
}

/** Record a session for gameId with its current mastery (never lowers it). */
export function recordPlay(
  profile: IcarusProfile,
  gameId: string,
  mastery: number,
  todayKey: string = dailyKeyUTC(),
): IcarusProfile {
  const entry = profile.games[gameId] ?? { plays: 0, lastPlayed: '', mastery: 0 };
  profile.games[gameId] = {
    plays: entry.plays + 1,
    lastPlayed: todayKey,
    mastery: Math.max(entry.mastery, Math.max(0, Math.min(1000, Math.round(mastery)))),
  };
  return profile;
}

/** Portfolio progress: sum of per-game mastery (0–4000 with four games). */
export function icarusScore(profile: IcarusProfile): number {
  return Object.values(profile.games).reduce((sum, g) => sum + g.mastery, 0);
}

/* --------------------------------------------------------------------------
 * Cross-promo — "More from Icarus" day-rotated sibling pitch.
 *
 * Links are policy-gated (Playables disallows outbound navigation), so the
 * card is brand-building copy only; a shell that may link (store listings)
 * can map `id` to a URL itself.
 * ------------------------------------------------------------------------ */

export interface SiblingPitch {
  id: string;
  name: string;
  pitch: string;
}

const SIBLING_TABLE: Record<string, SiblingPitch[]> = {
  swirl: [
    { id: 'fold', name: 'Fold', pitch: 'a calm origami puzzle — 30 paper folds' },
    { id: 'frenzy', name: 'Four-Leg Frenzy', pitch: 'waddle a derpy pup across 50 m' },
    { id: 'tissue', name: 'Tissue Rush', pitch: '25 pulls of pure speed' },
  ],
  fold: [
    { id: 'tissue', name: 'Tissue Rush', pitch: 'empty the box as fast as you can' },
    { id: 'swirl', name: 'Swirl!', pitch: 'stack the tallest soft-serve tower' },
    { id: 'frenzy', name: 'Four-Leg Frenzy', pitch: 'four legs, zero coordination' },
  ],
  frenzy: [
    { id: 'swirl', name: 'Swirl!', pitch: 'a steady-hand ice-cream stacker' },
    { id: 'tissue', name: 'Tissue Rush', pitch: 'a 60-second speed fix' },
    { id: 'fold', name: 'Fold', pitch: 'slow down with a paper puzzle' },
  ],
  tissue: [
    { id: 'frenzy', name: 'Four-Leg Frenzy', pitch: 'the funniest 50 m you will run' },
    { id: 'fold', name: 'Fold', pitch: '30 origami levels to master' },
    { id: 'swirl', name: 'Swirl!', pitch: 'how tall can you swirl?' },
  ],
  skim: [
    { id: 'tissue', name: 'Tissue Rush', pitch: 'empty the box as fast as you can' },
    { id: 'frenzy', name: 'Four-Leg Frenzy', pitch: 'four legs, zero coordination' },
    { id: 'fold', name: 'Fold', pitch: 'a calm origami puzzle — 30 paper folds' },
  ],
};

/** The sibling pitch for a game today — rotates daily, same for everyone. */
export function siblingForDay(gameId: string, seed: number = dateSeedUTC()): SiblingPitch {
  const list = SIBLING_TABLE[gameId] ?? [];
  return list[seed % Math.max(1, list.length)];
}
