/**
 * Four-Leg Frenzy — shared sim types and tuning constants.
 * Pure module — no DOM access. All distances in metres, angles in radians,
 * times in milliseconds unless suffixed otherwise. Positive pitch = nose up.
 */

/** Fixed simulation timestep (120 Hz). */
export const DT = 1 / 120;

export const TRACK_LENGTH = 50;
export const RACE_LIMIT_MS = 90_000;

/** Leg indices: front-left, front-right, back-left, back-right. */
export const LEG_FL = 0;
export const LEG_FR = 1;
export const LEG_BL = 2;
export const LEG_BR = 3;
export const LEG_COUNT = 4;

/** Hip longitudinal offset from the body centre (slight per-leg variation). */
export const LEG_OFFSET_X = [0.34, 0.3, -0.3, -0.34] as const;
/** Torque sign: front-leg plants pitch the nose up, back-leg plants down. */
export const LEG_SIGN = [1, 1, -1, -1] as const;

export type LegPhase = 'planted' | 'swing' | 'drop' | 'recover';

export interface LegState {
  phase: LegPhase;
  /** Hip angle: 0 = straight down, positive = swung forward. */
  angle: number;
  /** Furthest forward angle reached during the current swing. */
  peakAngle: number;
  /** Hip angle at the moment the current swing began. */
  swingFrom: number;
  /** World x of the hoof while planted. */
  plantX: number;
  /** Seconds the current swing input has been held. */
  holdTime: number;
}

export interface BodyState {
  x: number;
  v: number;
  /** Height of the body centre above the ground. */
  h: number;
  hv: number;
  pitch: number;
  pitchVel: number;
}

export type GameMode = 'race' | 'training';

export type SimEvent =
  | { type: 'lift'; leg: number }
  | { type: 'plant'; leg: number; strength: number }
  | { type: 'stumble' }
  | { type: 'fall' }
  | { type: 'finish' }
  | { type: 'timeout' };

export interface SimState {
  mode: GameMode;
  body: BodyState;
  legs: LegState[];
  /** Simulated elapsed time (excludes penalties). */
  timeMs: number;
  /** Accumulated penalty time from full falls (race). */
  penaltyMs: number;
  /** Furthest x ever reached. */
  distance: number;
  /** Recoverable wobbles (|pitch| past ~35°). */
  stumbles: number;
  /** Full flips (|pitch| past ~80°) — these carry the time penalty. */
  wipeouts: number;
  /** > 0 while stumbling / recovering after a fall. */
  stumbleT: number;
  finished: boolean;
  timedOut: boolean;
  rngState: number;
  /** Events produced by the most recent step; drained by the host. */
  events: SimEvent[];
}

export interface SimInput {
  held: [boolean, boolean, boolean, boolean];
}

export const NO_INPUT: SimInput = { held: [false, false, false, false] };

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Forward swing speed per leg (rad/s) — slight variation makes rhythm matter. */
export const SWING_SPEED = [3.4, 3.25, 3.3, 3.15] as const;
/** Furthest a leg can be swung forward (rad). */
export const SWING_MAX = 0.95;
/** Held legs auto-drop after this many seconds (anti soft-lock). */
export const MAX_HOLD = 1.2;
/** Released legs drop at this angular speed (rad/s). */
export const DROP_SPEED = 6.5;
/** Slipped legs scramble back under the body at this speed (rad/s). */
export const RECOVER_SPEED = 3;
/** Angle at which a dropping leg meets the ground. */
export const PLANT_ANGLE = 0;

/** Body forward velocity gained per radian of peak swing on plant. */
export const K_IMPULSE = 0.6;
/** Counter-torque gained per unit of impulse (front +, back −). */
export const K_TORQUE = 1.7;
/** Upward hop per unit of impulse. */
export const K_HOP = 0.35;
export const V_MAX = 5.5;

/** Velocity decay per second while running / while on the belly. */
export const DRAG = 0.32;
export const DRAG_BELLY = 2.5;

/** Rest height of the body centre; belly-on-ground height. */
export const REST_H = 0.62;
export const MIN_H = 0.3;
export const K_SPRING = 60;
export const C_SPRING = 9;
export const GRAVITY = 9.8;

export const K_PITCH = 10;
export const C_PITCH = 3.2;
/** Rhythmic forcing while poorly supported (proportional to speed). */
export const WOBBLE = 0.35;

/** |pitch| beyond ~35° stumbles; beyond ~80° is a full fall. */
export const STUMBLE_RAD = 0.61;
export const FLIP_RAD = 1.4;
export const STUMBLE_T = 0.9;
export const RECOVER_T = 1.2;
export const FALL_PENALTY_MS = 3000;
export const FALL_BACK_M = 2;

/** A planted hoof slips once the body moves this far past it. */
export const MAX_STRAIN = 0.5;
/** Straight-leg length (for display strain only). */
export const LEG_LEN = 0.62;

function makeLeg(index: number, bodyX: number): LegState {
  return {
    phase: 'planted',
    angle: 0,
    peakAngle: 0,
    swingFrom: 0,
    plantX: bodyX + LEG_OFFSET_X[index],
    holdTime: 0,
  };
}

export function createSim(mode: GameMode = 'race', seed = 1): SimState {
  return {
    mode,
    body: { x: 0, v: 0, h: REST_H, hv: 0, pitch: 0, pitchVel: 0 },
    legs: [makeLeg(0, 0), makeLeg(1, 0), makeLeg(2, 0), makeLeg(3, 0)],
    timeMs: 0,
    penaltyMs: 0,
    distance: 0,
    stumbles: 0,
    wipeouts: 0,
    stumbleT: 0,
    finished: false,
    timedOut: false,
    rngState: seed >>> 0,
    events: [],
  };
}

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
