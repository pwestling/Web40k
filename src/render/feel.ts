import { thunk, pick } from "../ui/sound";

/**
 * How models feel in the hand (PX-3a, 3b): picked up they rise and lean
 * into the way they're carried; set down they drop, squash a little and
 * knock on the table. Poses are kept here, outside React, and read every
 * frame by the model renderers; nothing here touches the game state.
 */

export interface Pose {
  /** Inches above where the model stands. */
  lift: number;
  /** Lean, radians, about the table's x and z axes. */
  tiltX: number;
  tiltZ: number;
  /** Height scale, 1 at rest. */
  squash: number;
  /** Shoved across the table, inches (a charge striking home). */
  dx?: number;
  dy?: number;
}

const LIFT = 0.4;
const LIFT_MS = 120;
const DROP_MS = 90;
const SQUASH_MS = 120;
const RING_MS = 250;
const MAX_TILT = (6 * Math.PI) / 180;

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type Held = { start: number; tiltX: number; tiltZ: number; vx: number; vy: number; quietUntil: number };
type Landing = { start: number; from: number };

const held = new Map<string, Held>();
const jolts = new Map<string, { start: number; x: number; y: number }>();
const JOLT_MS = 190;
const landing = new Map<string, Landing>();
/** Rings spreading from bases just set down: where, how wide, when. */
export const rings: { x: number; y: number; z: number; radius: number; start: number }[] = [];
/** When any pose last changed, so renderers know to redraw once more after the last one ends. */
let lastActive = 0;

/** A slight overshoot, like a hand lifting a bit too far then steadying. */
const backOut = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** Models taken in hand: they rise. */
export function pickUp(ids: string[], now = performance.now(), sound = true): void {
  for (const id of ids) {
    landing.delete(id);
    if (!held.has(id)) held.set(id, { start: now, tiltX: 0, tiltZ: 0, vx: 0, vy: 0, quietUntil: 0 });
  }
  if (sound && ids.length) pick();
  lastActive = now;
}

/** The hand's velocity, in inches per second across the table: held models lean into it. */
export function carry(vx: number, vy: number): void {
  for (const h of held.values()) {
    h.vx = vx;
    h.vy = vy;
  }
}

/**
 * Models let go: they come down, squash and knock. `at` gives each base's
 * place and radius for its ring; `dull` is an over-limit drop (advisory, no buzzer).
 */
export function setDown(
  ids: string[],
  at: (id: string) => { x: number; y: number; z: number; radius: number } | null,
  { now = performance.now(), dull = false, sound = true } = {},
): void {
  let n = 0;
  for (const id of ids) {
    const h = held.get(id);
    held.delete(id);
    const from = h ? currentLift(h, now) : 0;
    landing.set(id, { start: now, from });
    const p = at(id);
    if (p) rings.push({ ...p, start: now + DROP_MS });
    n++;
  }
  if (rings.length > 80) rings.splice(0, rings.length - 80);
  if (sound && n) setTimeout(() => thunk(n, dull), DROP_MS);
  lastActive = now;
}

function currentLift(h: Held, now: number): number {
  const t = Math.min(1, (now - h.start) / LIFT_MS);
  return LIFT * backOut(t);
}

/** Lean and decay, once a frame. `dt` in seconds. */
export function stepFeel(dt: number, now = performance.now()): void {
  if (!held.size) return;
  const still = reduced();
  for (const h of held.values()) {
    // Lean up to 6° toward the travel, springing back as the hand slows.
    const speed = Math.hypot(h.vx, h.vy);
    const lean = still ? 0 : Math.min(MAX_TILT, speed * 0.01);
    const tx = speed > 0 ? (h.vy / speed) * lean : 0;
    const tz = speed > 0 ? (-h.vx / speed) * lean : 0;
    const k = Math.min(1, dt * 14);
    h.tiltX += (tx - h.tiltX) * k;
    h.tiltZ += (tz - h.tiltZ) * k;
    // The hand's speed fades unless the pointer keeps moving.
    h.vx *= Math.max(0, 1 - dt * 8);
    h.vy *= Math.max(0, 1 - dt * 8);
  }
  lastActive = now;
}

/** Models hit by a charge: knocked 0.1" along `dir` (a unit vector) and back (PX-3c). */
export function jolt(ids: string[], dir: { x: number; y: number }, now = performance.now()): void {
  if (reduced()) return;
  for (const id of ids) jolts.set(id, { start: now, x: dir.x, y: dir.y });
  lastActive = now;
}

/** A model's pose now, or null at rest. */
export function poseOf(id: string, now = performance.now()): Pose | null {
  const pose = basePose(id, now);
  const j = jolts.get(id);
  if (!j) return pose;
  const t = now - j.start;
  if (t >= JOLT_MS) {
    jolts.delete(id);
    return pose;
  }
  const k = 0.1 * (t < 40 ? t / 40 : 1 - (t - 40) / (JOLT_MS - 40));
  return { ...(pose ?? { lift: 0, tiltX: 0, tiltZ: 0, squash: 1 }), dx: j.x * k, dy: j.y * k };
}

function basePose(id: string, now: number): Pose | null {
  const h = held.get(id);
  if (h) return { lift: currentLift(h, now), tiltX: h.tiltX, tiltZ: h.tiltZ, squash: 1 };
  const l = landing.get(id);
  if (!l) return null;
  const t = now - l.start;
  if (t >= DROP_MS + SQUASH_MS) {
    landing.delete(id);
    return null;
  }
  if (t < DROP_MS) {
    const k = t / DROP_MS;
    return { lift: l.from * (1 - k * k), tiltX: 0, tiltZ: 0, squash: 1 };
  }
  const k = (t - DROP_MS) / SQUASH_MS;
  return { lift: 0, tiltX: 0, tiltZ: 0, squash: reduced() ? 1 : 0.96 + 0.04 * k };
}

/** Whether renderers need to redraw poses this frame (and one frame after the last). */
export function feelActive(now = performance.now()): boolean {
  if (held.size || landing.size || jolts.size) {
    lastActive = now;
    return true;
  }
  return now - lastActive < 50;
}

export const RING_DURATION = RING_MS;
