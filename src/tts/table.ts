import type { BaseShape } from "../core";
import {
  cleanText,
  customOf,
  GENERIC_BAG,
  looksLikeTerrain,
  saveObjects,
  type TtsObject,
} from "../figures/tts";

/**
 * A whole Tabletop Simulator table (#73): the terrain where it stands and the
 * armies where they were deployed, read from a save. Pure; the importer
 * (bring.ts) fetches the models and builds the table and shelf armies.
 *
 * TTS measures one unit to the inch with (0, 0) at the table's centre, as we
 * do. It is a left-handed world (Unity) and mirrors OBJ files as it loads
 * them, so the two mirrorings cancel: an OBJ drawn our way is the same model,
 * turned by π − TTS's yaw, standing at TTS's x and minus its z.
 */

export interface TtsPose {
  /** Board inches: TTS x, and minus TTS z. */
  x: number;
  y: number;
  /** Our facing (radians, 0 towards +y): π minus TTS's yaw. */
  facing: number;
}

/** One object on the table, or in a bag on it. */
export interface TtsThing {
  /** The model's key (scanSave / customOf): the same mesh, image and size. */
  key: string;
  mesh: string;
  diffuse?: string;
  scale: number;
  nickname: string;
  /** TTS's description as written, markup and all (the profile reader parses it, #74). */
  description: string;
  pose: TtsPose;
  /** A TTS board model (CustomMesh type 4): a table mat when it's big and flat. */
  board?: boolean;
}

export interface TtsUnit {
  name: string;
  /** Which army: 0 is Player 1's (it ends up on the +y half), 1 is Player 2's. See splitSides. */
  side: 0 | 1;
  models: TtsThing[];
  /** On the table where they stand, or still in a bag (deployed as usual). */
  placed: boolean;
  /** Where its bag sits, for a unit still in one. */
  bag?: TtsPose;
}

export interface TtsTable {
  title: string;
  terrain: TtsThing[];
  units: TtsUnit[];
}

/** Models of a name this close (edge to edge, roughly) belong to one unit. */
const SAME_UNIT = 4;

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

function poseOf(o: TtsObject): TtsPose {
  const t = o.Transform ?? {};
  return {
    x: round(t.posX ?? 0),
    y: round(-(t.posZ ?? 0)),
    facing: wrap(Math.PI - ((t.rotY ?? 0) * Math.PI) / 180),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000 || 0;

function thing(o: TtsObject): TtsThing | null {
  const custom = customOf(o);
  if (!custom) return null;
  return {
    ...custom,
    nickname: cleanText(o.Nickname),
    description: (o.Description ?? "").trim(),
    pose: poseOf(o),
    ...(o.CustomMesh?.TypeIndex === 4 ? { board: true } : {}),
  };
}

/** A bag's figures, at any depth (bags in bags). */
function bagged(o: TtsObject): TtsThing[] {
  return (o.ContainedObjects ?? []).flatMap((c) => {
    const t = thing(c);
    return t && !looksLikeTerrain(c) ? [t] : bagged(c);
  });
}

export function scanTable(json: unknown): TtsTable {
  const { title, objects } = saveObjects(json);
  const terrain: TtsThing[] = [];
  const loose: TtsThing[] = [];
  const units: TtsUnit[] = [];
  for (const o of objects) {
    if (!o || typeof o !== "object") continue;
    const t = thing(o);
    if (t) {
      (looksLikeTerrain(o) ? terrain : loose).push(t);
      continue;
    }
    // A bag on the table: its figures are a unit not deployed yet, on the side the bag sits.
    const inside = bagged(o);
    if (!inside.length) continue;
    const pose = poseOf(o);
    const bag = cleanText(o.Nickname);
    units.push({
      name: bag && !GENERIC_BAG.test(bag) ? bag : (inside[0]!.nickname ?? "") || "Unit",
      side: 0,
      models: inside,
      placed: false,
      bag: pose,
    });
  }
  // Figures standing on the table: by name, then into groups standing together.
  const byName = new Map<string, TtsThing[]>();
  for (const t of loose) byName.set(t.nickname, [...(byName.get(t.nickname) ?? []), t]);
  const placed: TtsUnit[] = [];
  for (const [name, all] of byName)
    for (const group of clusters(all))
      placed.push({ name: name || "Unit", side: 0, models: group, placed: true });
  const all = splitSides([...placed, ...units]);
  // Each army's units across the table, so they keep an order players recognise; bags last.
  return {
    title,
    terrain,
    units: all.sort((a, b) => +!a.placed - +!b.placed || a.side - b.side || whereIs(a).x - whereIs(b).x),
  };
}

/** A unit's middle, or its bag's place. */
function whereIs(u: TtsUnit): { x: number; y: number } {
  if (!u.placed && u.bag) return u.bag;
  const n = u.models.length || 1;
  return {
    x: u.models.reduce((s, m) => s + m.pose.x, 0) / n,
    y: u.models.reduce((s, m) => s + m.pose.y, 0) / n,
  };
}

/** Two groups standing further apart than this along an axis are two armies. */
const ARMY_GAP = 6;

/**
 * Which army each unit is in (UX 473): the two groups of figures as they
 * stand, split across the widest gap between unit middles along either
 * axis, so armies on the short edges split as well as on the long ones. The
 * group further along +y (or −x, for a split across x) is Player 1's. With
 * no clear gap, the table's halves decide. A bag joins the army nearest it.
 */
function splitSides(units: TtsUnit[]): TtsUnit[] {
  const placed = units.filter((u) => u.placed);
  const gapOn = (k: "x" | "y") => {
    const vs = placed.map((u) => whereIs(u)[k]).sort((a, b) => a - b);
    let best = { gap: 0, at: 0 };
    for (let i = 1; i < vs.length; i++)
      if (vs[i]! - vs[i - 1]! > best.gap) best = { gap: vs[i]! - vs[i - 1]!, at: (vs[i]! + vs[i - 1]!) / 2 };
    return best;
  };
  const gx = gapOn("x");
  const gy = gapOn("y");
  const sideOf: (p: { x: number; y: number }) => 0 | 1 =
    gx.gap >= ARMY_GAP && gx.gap > gy.gap
      ? (p) => (p.x < gx.at ? 0 : 1)
      : gy.gap >= ARMY_GAP
        ? (p) => (p.y > gy.at ? 0 : 1)
        : (p) => (p.y >= 0 ? 0 : 1);
  const out = units.map((u) => (u.placed ? { ...u, side: sideOf(whereIs(u)) } : u));
  const middle = (side: 0 | 1) => {
    const us = out.filter((u) => u.placed && u.side === side).map(whereIs);
    return us.length
      ? { x: us.reduce((s, p) => s + p.x, 0) / us.length, y: us.reduce((s, p) => s + p.y, 0) / us.length }
      : null;
  };
  const m0 = middle(0);
  const m1 = middle(1);
  const far = (p: { x: number; y: number }, m: { x: number; y: number } | null) =>
    m ? Math.hypot(p.x - m.x, p.y - m.y) : Infinity;
  return out.map((u) => {
    if (u.placed) return u;
    const p = whereIs(u);
    const side: 0 | 1 = m0 || m1 ? (far(p, m0) <= far(p, m1) ? 0 : 1) : sideOf(p);
    return { ...u, side };
  });
}

/** Single-linkage groups: models within SAME_UNIT of one another, chained. */
function clusters(models: TtsThing[]): TtsThing[][] {
  const left = [...models];
  const out: TtsThing[][] = [];
  while (left.length) {
    const group = [left.pop()!];
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!.pose;
      for (let j = left.length - 1; j >= 0; j--) {
        const b = left[j]!.pose;
        if (Math.hypot(a.x - b.x, a.y - b.y) <= SAME_UNIT) group.push(...left.splice(j, 1));
      }
    }
    // Left to right, then front to back: the order TTS players laid them out in, more or less.
    out.push(group.sort((a, b) => a.pose.x - b.pose.x || a.pose.y - b.pose.y));
  }
  return out;
}

/**
 * Where a model stands once its mesh is centred as our pipeline centres it:
 * `centre` is the middle of the OBJ's footprint (and its lowest point) in the
 * file's own units, which TTS turns and scales about the object's position.
 */
export function placeOnTable(pose: TtsPose, centre: [number, number, number], scale: number): TtsPose {
  const cx = centre[0] * scale;
  const cz = centre[2] * scale;
  const c = Math.cos(pose.facing);
  const s = Math.sin(pose.facing);
  // A turn about the up axis, as the board draws a facing (rotation-y): x' = x cos + z sin, z' = −x sin + z cos.
  return { x: round(pose.x + cx * c + cz * s), y: round(pose.y - cx * s + cz * c), facing: pose.facing };
}

/** The middle of an OBJ's footprint and its lowest point, read from its vertices. */
export function objCentre(text: string): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of text.matchAll(/^v\s+(\S+)\s+(\S+)\s+(\S+)/gm))
    for (let a = 0; a < 3; a++) {
      const v = Number(m[a + 1]);
      if (!Number.isFinite(v)) continue;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  if (!(min[0]! <= max[0]!)) return [0, 0, 0];
  return [(min[0]! + max[0]!) / 2, min[1]!, (min[2]! + max[2]!) / 2];
}

const ROUND_BASES = [25, 28.5, 32, 40, 50, 60, 80, 90, 100, 130, 160];

/** A base for a figure from its footprint in inches: the nearest common round base, or an oval when long. */
export function baseFor(width: number, depth: number): BaseShape {
  const mm = (x: number) => x * 25.4;
  const [lo, hi] = [Math.min(width, depth), Math.max(width, depth)];
  if (hi > lo * 1.4 && lo > 0) {
    const r5 = (x: number) => Math.max(25, Math.round(mm(x) / 5) * 5);
    return { shape: "oval", widthMm: r5(width), depthMm: r5(depth) };
  }
  const want = mm(lo);
  const diameterMm = ROUND_BASES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  return { shape: "round", diameterMm };
}

/** The whole table turned about its centre by `angle` (radians, counter-clockwise seen from above). */
export function turnTable(table: TtsTable, angle: number): TtsTable {
  if (!angle) return table;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const turn = (t: TtsThing): TtsThing => ({
    ...t,
    pose: {
      x: round(t.pose.x * c - t.pose.y * s),
      y: round(t.pose.x * s + t.pose.y * c),
      facing: wrap(t.pose.facing - angle),
    },
  });
  // Which army a unit is in doesn't change as the table turns: everything turns, bags too (UX 474).
  return {
    ...table,
    terrain: table.terrain.map(turn),
    units: table.units.map((u) => ({
      ...u,
      models: u.models.map(turn),
      ...(u.bag ? { bag: turn({ pose: u.bag } as TtsThing).pose } : {}),
    })),
  };
}

/** Each army's middle on the table, or null for an army with nothing standing. */
export function armyMiddle(table: TtsTable, side: 0 | 1): { x: number; y: number } | null {
  const us = table.units.filter((u) => u.placed && u.side === side).map(whereIs);
  if (!us.length) return null;
  return { x: us.reduce((s, p) => s + p.x, 0) / us.length, y: us.reduce((s, p) => s + p.y, 0) / us.length };
}
