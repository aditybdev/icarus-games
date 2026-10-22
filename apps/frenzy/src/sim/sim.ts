/**
 * Four-Leg Frenzy — core fixed-timestep simulation step.
 *
 * Model: the Wobblebeest is a rigid body (x, v, height, pitch) supported by
 * four two-segment legs. Holding a leg input swings that leg forward off the
 * ground; releasing drops it. When a dropping leg reaches the ground it
 * plants, kicking the body forward (impulse ∝ how far it was swung) and
 * applying a counter-torque (front legs pitch the nose up, back legs down).
 * Alternating diagonal pairs (FL+BR / FR+BL) cancels the torques and builds
 * efficient speed; mashing same-end legs pitches the body into a stumble.
 *
 * Pure module — no DOM. Given the same seed and input sequence the state
 * evolves bit-identically on every run.
 */

import { nextRandom } from './prng';
import {
  C_PITCH,
  C_SPRING,
  DRAG,
  DRAG_BELLY,
  DROP_SPEED,
  DT,
  FALL_BACK_M,
  FALL_PENALTY_MS,
  FLIP_RAD,
  GRAVITY,
  K_HOP,
  K_IMPULSE,
  K_PITCH,
  K_SPRING,
  K_TORQUE,
  LEG_COUNT,
  LEG_OFFSET_X,
  LEG_SIGN,
  MAX_HOLD,
  MAX_STRAIN,
  MIN_H,
  PLANT_ANGLE,
  RACE_LIMIT_MS,
  RECOVER_SPEED,
  RECOVER_T,
  REST_H,
  STUMBLE_RAD,
  STUMBLE_T,
  SWING_MAX,
  SWING_SPEED,
  SimState,
  SimInput,
  TRACK_LENGTH,
  V_MAX,
  WOBBLE,
  clamp,
} from './types';

export interface StepOptions {
  /** Race only: countdown and timeout detection (default true). */
  trackLimit?: boolean;
}

/** Advance the simulation by exactly one fixed step (default 1/120 s). */
export function stepSim(s: SimState, input: SimInput, dt: number = DT, opts: StepOptions = {}): void {
  s.events.length = 0;
  if (s.finished || s.timedOut) return;

  const body = s.body;
  s.timeMs += dt * 1000;

  // Belly on the ground forces every leg to drop — the creature can never be
  // parked indefinitely with all legs held up (anti soft-lock).
  const bellyDown = body.h <= MIN_H + 1e-6;

  // ------------------------------------------------------------------ legs
  let plantedCount = 0;
  for (let i = 0; i < LEG_COUNT; i++) {
    const leg = s.legs[i];
    const held = input.held[i] && !bellyDown;
    const hipX = body.x + LEG_OFFSET_X[i];

    if (leg.phase === 'planted') {
      if (held) {
        leg.phase = 'swing';
        leg.holdTime = 0;
        leg.peakAngle = leg.angle;
        leg.swingFrom = leg.angle;
        s.events.push({ type: 'lift', leg: i });
      } else {
        plantedCount++;
        const strain = hipX - leg.plantX;
        if (strain > MAX_STRAIN) {
          // The body outran the hoof: it slips and scrambles forward again.
          leg.phase = 'recover';
          leg.angle = clamp(-strain * 0.5, -0.7, 0);
        } else {
          leg.angle = -Math.atan2(strain, 0.62);
        }
      }
    } else if (leg.phase === 'swing') {
      leg.holdTime += dt;
      leg.angle = Math.min(SWING_MAX, leg.angle + SWING_SPEED[i] * dt);
      if (leg.angle > leg.peakAngle) leg.peakAngle = leg.angle;
      if (!held || leg.holdTime > MAX_HOLD) leg.phase = 'drop';
    } else if (leg.phase === 'drop') {
      leg.angle -= DROP_SPEED * dt;
      if (leg.angle <= PLANT_ANGLE) {
        leg.angle = PLANT_ANGLE;
        leg.phase = 'planted';
        leg.plantX = hipX;
        // Impulse rewards the full forward arc of the swing, so fast running
        // (which drags planted hooves backward) doesn't weaken the next kick.
        // A leg that plants while the belly is grounded only scrambles — no
        // kick — so flopping on the belly can never be a propulsion exploit.
        const imp = bellyDown ? 0 : K_IMPULSE * Math.max(0, leg.peakAngle - leg.swingFrom);
        if (imp > 0.03) {
          body.v = Math.min(V_MAX, body.v + imp);
          body.pitchVel += K_TORQUE * imp * LEG_SIGN[i];
          body.hv += K_HOP * imp;
        }
        s.events.push({ type: 'plant', leg: i, strength: imp });
        leg.peakAngle = 0;
      }
    } else {
      // recover: scramble the slipped hoof back under the body, replant softly
      leg.angle = Math.min(0, leg.angle + RECOVER_SPEED * dt);
      if (leg.angle >= 0) {
        leg.angle = 0;
        leg.phase = 'planted';
        leg.plantX = hipX;
        leg.peakAngle = 0;
      }
    }
  }

  // ------------------------------------------------------------- vertical
  if (plantedCount > 0) {
    const k = K_SPRING * (0.5 + plantedCount / LEG_COUNT);
    body.hv += (k * (REST_H - body.h) - C_SPRING * body.hv) * dt;
  } else {
    body.hv -= GRAVITY * dt;
  }
  body.h += body.hv * dt;
  if (body.h < MIN_H) {
    body.h = MIN_H;
    if (body.hv < -2.2) {
      // Heavy belly flop: knocks speed off and rattles the body.
      body.pitchVel += (nextRandom(s) - 0.5) * 1.2;
      body.v *= 0.6;
    }
    body.hv = 0;
  }

  // ---------------------------------------------------------------- pitch
  const support = 0.25 + 0.75 * (plantedCount / LEG_COUNT);
  let stiffness = K_PITCH * support;
  let damping = C_PITCH;
  if (s.stumbleT > 0) {
    stiffness *= 5;
    damping *= 2;
    s.stumbleT = Math.max(0, s.stumbleT - dt);
  }
  const wobble = WOBBLE * body.v * Math.sin(s.timeMs * 0.011) * (1 - plantedCount / LEG_COUNT);
  body.pitchVel += (-stiffness * body.pitch - damping * body.pitchVel + wobble) * dt;
  body.pitchVel = clamp(body.pitchVel, -12, 12);
  body.pitch = clamp(body.pitch + body.pitchVel * dt, -1.6, 1.6);

  // ------------------------------------------------------- forward motion
  const drag = bellyDown ? DRAG_BELLY : DRAG;
  body.v = clamp(body.v - body.v * drag * dt, 0, V_MAX);
  body.x += body.v * dt;
  if (body.x > s.distance) s.distance = body.x;

  // ---------------------------------------------------- stumble and fall
  if (s.stumbleT <= 0) {
    const tilt = Math.abs(body.pitch);
    if (tilt > FLIP_RAD) {
      // Full flip: count a wipeout, reset to the track with a time penalty.
      s.wipeouts++;
      s.penaltyMs += FALL_PENALTY_MS;
      body.x = Math.max(0, body.x - FALL_BACK_M);
      body.v = 0;
      body.pitch = 0;
      body.pitchVel = 0;
      body.h = REST_H;
      body.hv = 0;
      for (let i = 0; i < LEG_COUNT; i++) {
        const leg = s.legs[i];
        leg.phase = 'planted';
        leg.angle = 0;
        leg.peakAngle = 0;
        leg.holdTime = 0;
        leg.plantX = body.x + LEG_OFFSET_X[i];
      }
      s.stumbleT = RECOVER_T;
      s.events.push({ type: 'fall' });
    } else if (tilt > STUMBLE_RAD) {
      // Stumble: lose speed, brief wild recovery, always auto-recovers.
      s.stumbles++;
      s.stumbleT = STUMBLE_T;
      body.v *= 0.45;
      body.pitchVel = -Math.sign(body.pitch) * 2 + (nextRandom(s) - 0.5) * 0.5;
      s.events.push({ type: 'stumble' });
    }
  }

  // ------------------------------------------------------- race outcomes
  if (s.mode === 'race') {
    if (body.x >= TRACK_LENGTH) {
      s.finished = true;
      if (s.distance < TRACK_LENGTH) s.distance = TRACK_LENGTH;
      s.events.push({ type: 'finish' });
    } else if (opts.trackLimit !== false && s.timeMs + s.penaltyMs >= RACE_LIMIT_MS) {
      s.timedOut = true;
      s.events.push({ type: 'timeout' });
    }
  }
}
