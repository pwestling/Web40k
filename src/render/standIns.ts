import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { StandInLook } from "../core";

/**
 * Procedural stand-in figures (#42): a few primitives merged into one shape
 * per look, so a game can show troopers, brutes, beasts, walkers and drones
 * without any uploaded model. Each is built for a footprint `w` x `d` and a
 * height `h` (inches), standing on y = 0 and facing +z (the base's nub).
 */
type Part = BufferGeometry;

const at = (g: Part, x: number, y: number, z: number) => g.translate(x, y, z);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  at(new BoxGeometry(w, h, d), x, y + h / 2, z);
const ball = (r: number, x: number, y: number, z: number) => at(new SphereGeometry(r, 12, 8), x, y, z);
const pill = (r: number, len: number, x: number, y: number, z: number) =>
  at(new CapsuleGeometry(r, Math.max(0.01, len), 3, 10), x, y + len / 2 + r, z);
const post = (r: number, h: number, x: number, y: number, z: number) =>
  at(new CylinderGeometry(r, r, h, 10), x, y + h / 2, z);

/** A person-shaped figure: legs, a torso, shoulders, a head, and something held forward. */
function trooper(w: number, h: number, bulk = 1): Part[] {
  const r = (w / 2) * 0.32 * bulk;
  const leg = h * 0.42;
  const torso = h * 0.36;
  const head = h * 0.1;
  return [
    post(r * 0.45, leg, -r * 0.5, 0, 0),
    post(r * 0.45, leg, r * 0.5, 0, 0),
    pill(r, Math.max(0.01, torso - 2 * r), 0, leg, 0),
    box(r * 3.1, r * 0.8, r * 1.4, 0, leg + torso - r * 0.9, 0),
    ball(head, 0, leg + torso + head * 0.9, 0),
    // A held weapon or tool, pointing forward.
    box(r * 0.35, r * 0.35, r * 2.4, r * 1.1, leg + torso * 0.55, r * 1.1),
  ];
}

/** A long-robed figure: a cone of robes, a hood, and a staff. */
function robed(w: number, h: number): Part[] {
  const r = (w / 2) * 0.55;
  const body = h * 0.8;
  return [
    at(new ConeGeometry(r, body, 12), 0, body / 2, 0),
    ball(h * 0.11, 0, body + h * 0.06, 0),
    post(r * 0.08, h * 1.05, r * 0.85, 0, r * 0.4),
    ball(r * 0.18, r * 0.85, h * 1.05, r * 0.4),
  ];
}

/** Four legs, a long body and a head forward, with a tail. */
function beast(w: number, d: number, h: number): Part[] {
  const len = Math.max(w, d) * 0.75;
  const r = Math.min(h * 0.22, (w / 2) * 0.35);
  const legH = h * 0.45;
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => post(r * 0.3, legH, sx * r * 0.8, 0, sz * len * 0.3)),
  );
  const body = new CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 3, 10).rotateX(Math.PI / 2);
  return [
    ...legs,
    at(body, 0, legH + r * 0.6, 0),
    ball(r * 0.75, 0, legH + r * 1.3, len / 2 + r * 0.2),
    at(new ConeGeometry(r * 0.3, len * 0.4, 6).rotateX(-Math.PI / 2.6), 0, legH + r * 0.8, -len / 2),
  ];
}

/** A boxy hull on two stout legs, with arms. */
function walker(w: number, h: number): Part[] {
  const s = w / 2;
  const legH = h * 0.45;
  const hull = h * 0.35;
  return [
    box(s * 0.35, legH, s * 0.4, -s * 0.4, 0, 0),
    box(s * 0.35, legH, s * 0.4, s * 0.4, 0, 0),
    box(s * 1.3, hull, s * 1.0, 0, legH, 0),
    box(s * 0.5, h * 0.12, s * 0.5, 0, legH + hull, s * 0.1),
    box(s * 0.25, s * 0.25, s * 1.0, -s * 0.85, legH + hull * 0.4, s * 0.3),
    box(s * 0.25, s * 0.25, s * 1.0, s * 0.85, legH + hull * 0.4, s * 0.3),
  ];
}

/** A hovering orb on a thin stand, with fins. */
function drone(w: number, h: number): Part[] {
  const r = Math.min((w / 2) * 0.5, h * 0.25);
  return [
    post(0.06, h - r, 0, 0, 0),
    ball(r, 0, h - r, 0),
    box(r * 2.6, r * 0.12, r * 0.6, 0, h - r, -r * 0.2),
    ball(r * 0.3, 0, h - r, r * 0.85),
  ];
}

/** A low hull with a turret. */
function vehicle(w: number, d: number, h: number): Part[] {
  return [
    box(w * 0.8, h * 0.5, d * 0.85, 0, 0, 0),
    box(w * 0.45, h * 0.3, d * 0.35, 0, h * 0.5, -d * 0.05),
    box(w * 0.08, w * 0.08, d * 0.4, 0, h * 0.6, d * 0.25),
  ];
}

/** The merged figure for a look, standing on y = 0. */
export function lookGeometry(look: StandInLook, w: number, d: number, h: number): BufferGeometry {
  const parts =
    look.shape === "brute"
      ? trooper(w, h, 1.5)
      : look.shape === "robed"
        ? robed(w, h)
        : look.shape === "beast"
          ? beast(w, d, h)
          : look.shape === "walker"
            ? walker(w, h)
            : look.shape === "drone"
              ? drone(w, h)
              : look.shape === "vehicle"
                ? vehicle(w, d, h)
                : trooper(w, h);
  // Same attributes everywhere: primitives come with position, normal and uv.
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  return merged ?? new BoxGeometry(w * 0.5, h, d * 0.5).translate(0, h / 2, 0);
}
