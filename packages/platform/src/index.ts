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
  bindLifecycle({ pause, resume }: LifecycleHandlers): void {
    let paused = false;
    const safePause = () => {
      if (paused) return;
      paused = true;
      pause();
    };
    const safeResume = () => {
      if (!paused) return;
      paused = false;
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
    console.error(`[platform] ${errorType}:`, error);
  }
}

export function createPlatform(gameId: string): Platform {
  return new Platform(gameId);
}
