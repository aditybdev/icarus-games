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
    onPause?: (cb: () => void) => void;
    onResume?: (cb: () => void) => void;
  };
  engagement?: {
    sendScore?: (score: { value: number }) => void;
  };
  health?: {
    reportError?: (err: { errorType: string; errorMessage: string }) => void;
  };
  system?: {
    isAudioEnabled?: () => boolean;
    onAudioEnabledChange?: (cb: (enabled: boolean) => void) => void;
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
        yt.game?.onPause?.(safePause);
        yt.game?.onResume?.(safeResume);
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
      window.ytgame?.health?.reportError?.({ errorType, errorMessage: message });
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
