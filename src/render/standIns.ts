import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { StandInGear, StandInLook } from "../core";

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

/**
 * A person-shaped figure: legs, a torso, shoulders, a head, and something held
 * forward, with its gear: a shield, a pole or a lamp, a cog on the back,
 * thorns, blades for hands, or bent low.
 */
function trooper(w: number, h: number, bulk = 1, gear: StandInGear[] = []): Part[] {
  const r = (w / 2) * 0.32 * bulk;
  const hunched = gear.includes("hunched");
  const leg = h * (hunched ? 0.36 : 0.42);
  const torso = h * 0.36;
  const head = h * 0.1;
  // Bent low: shoulders and head forward and down.
  const lean = hunched ? r * 0.9 : 0;
  const top = leg + torso - (hunched ? h * 0.06 : 0);
  const parts = [
    post(r * 0.45, leg, -r * 0.5, 0, 0),
    post(r * 0.45, leg, r * 0.5, 0, 0),
    pill(r, Math.max(0.01, torso - 2 * r), 0, leg, lean * 0.4),
    box(r * 3.1, r * 0.8, r * 1.4, 0, top - r * 0.9, lean),
    ball(head, 0, top + head * 0.9, lean * 1.3),
  ];
  const hand = { y: leg + torso * 0.55, z: r * 1.1 + lean * 0.5 };
  if (gear.includes("blades"))
    // A long blade in each hand, angled forward and down.
    for (const side of [-1, 1])
      parts.push(
        at(new BoxGeometry(r * 0.12, r * 0.5, r * 3).rotateX(0.35), side * r * 1.3, hand.y, hand.z + r * 0.6),
      );
  else if (!gear.includes("unarmed") && !gear.includes("lamp"))
    parts.push(box(r * 0.35, r * 0.35, r * 2.4, r * 1.1, hand.y, hand.z));
  if (gear.includes("shield"))
    parts.push(box(r * 0.25, r * 2.6, r * 2, -r * 1.75, leg * 0.7, r * 0.7 + lean));
  if (gear.includes("pole")) {
    // A tall pole with a lantern hung at the top.
    parts.push(post(r * 0.12, h * 1.2, r * 1.5, 0, r * 0.2));
    parts.push(box(r * 0.9, r * 0.12, r * 0.12, r * 1.5 + r * 0.35, h * 1.15, r * 0.2));
    parts.push(box(r * 0.55, r * 0.75, r * 0.55, r * 1.5 + r * 0.75, h * 1.15 - r * 0.85, r * 0.2));
  }
  if (gear.includes("lamp")) {
    // An arm raised, a lamp held high above the head.
    parts.push(box(r * 0.35, h * 0.32, r * 0.35, r * 1.3, top - r * 0.6, lean));
    parts.push(ball(r * 0.55, r * 1.3, top + h * 0.3, lean));
  }
  if (gear.includes("cog")) {
    // A cog on the back: a disc with teeth round its rim.
    const cy = leg + torso * 0.6;
    const cz = -r * 1.25;
    parts.push(at(new CylinderGeometry(r * 1.15, r * 1.15, r * 0.35, 16).rotateX(Math.PI / 2), 0, cy, cz));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(
        at(
          new BoxGeometry(r * 0.4, r * 0.4, r * 0.35).rotateZ(a),
          Math.cos(a) * r * 1.3,
          cy + Math.sin(a) * r * 1.3,
          cz,
        ),
      );
    }
  }
  if (gear.includes("thorns"))
    // Thorns out of the shoulders, back and head.
    for (const [x, y, z, tx, tz] of [
      [-r * 1.4, top - r * 0.4, 0, 0, 0.9],
      [r * 1.4, top - r * 0.4, 0, 0, -0.9],
      [0, top + head * 1.6, lean * 1.3, 0.3, 0],
      [-r * 0.6, leg + torso * 0.6, -r * 0.9, -1.1, 0.4],
      [r * 0.6, leg + torso * 0.6, -r * 0.9, -1.1, -0.4],
      [0, leg + torso * 0.3, -r * 1, -1.3, 0],
    ] as const)
      parts.push(at(new ConeGeometry(r * 0.22, r * 1.1, 5).rotateX(tx).rotateZ(tz), x, y, z));
  return parts;
}

/** A briar mound: a low hump of tangled growth bristling with thorns. */
function mound(w: number, d: number, h: number): Part[] {
  const r = Math.min(w, d) * 0.42;
  const hump = new SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1);
  const parts = [
    hump,
    ball(r * 0.45, -r * 0.45, h * 0.45, r * 0.3),
    ball(r * 0.4, r * 0.5, h * 0.5, -r * 0.2),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const up = 0.35 + (i % 3) * 0.2;
    const x = Math.cos(a) * r * 0.75;
    const z = Math.sin(a) * r * 0.75;
    parts.push(
      at(
        new ConeGeometry(r * 0.08, r * 0.6, 5).rotateZ(-Math.cos(a) * 0.9).rotateX(Math.sin(a) * 0.9),
        x,
        h * up + r * 0.2,
        z,
      ),
    );
  }
  return parts;
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
      ? trooper(w, h, 1.5, look.gear)
      : look.shape === "mound"
        ? mound(w, d, h)
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
                  : trooper(w, h, 1, look.gear);
  // Same attributes everywhere: primitives come with position, normal and uv.
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  return merged ?? new BoxGeometry(w * 0.5, h, d * 0.5).translate(0, h / 2, 0);
}
