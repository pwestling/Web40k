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
  /** Its LuaScript, when it has one: Yellowscribe's leader models carry the unit's data there (#75). */
  script?: string;
  /** The unit Yellowscribe tagged it with ("uuid:…"): the models of one unit share it. */
  unit?: string;
  /** Terrain only: its tilt and uneven stretch, baked into the OBJ's vertices (bakeOf). */
  bake?: number[];
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
  /** Names of the Unity asset bundles on the table ("" when unnamed): only Unity can read them. */
  bundles?: string[];
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
  const unitTag = o.Tags?.find((t) => t.startsWith("uuid:"));
  return {
    ...custom,
    nickname: cleanText(o.Nickname),
    description: (o.Description ?? "").trim(),
    pose: poseOf(o),
    ...(o.CustomMesh?.TypeIndex === 4 ? { board: true } : {}),
    ...(o.LuaScript?.trim() ? { script: o.LuaScript } : {}),
    ...(unitTag ? { unit: unitTag.slice(5) } : {}),
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
  const bundles: string[] = [];
  for (const o of objects) {
    if (!o || typeof o !== "object") continue;
    if (o.Name === "Custom_AssetBundle") bundles.push(cleanText(o.Nickname));
    const t = thing(o);
    if (t) {
      if (!looksLikeTerrain(o)) loose.push(t);
      else {
        // A tilted or stretched piece is its own model: the same mesh baked another way.
        const bake = bakeOf(o, t.scale);
        terrain.push(bake ? { ...t, bake, key: `${t.key}|${bake.join(",")}` } : t);
      }
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
  // Models Yellowscribe tagged with one unit are that unit, whatever their names (#75).
  const byName = new Map<string, TtsThing[]>();
  const tagged = new Map<string, TtsThing[]>();
  for (const t of loose)
    if (t.unit) tagged.set(t.unit, [...(tagged.get(t.unit) ?? []), t]);
    else byName.set(t.nickname, [...(byName.get(t.nickname) ?? []), t]);
  const placed: TtsUnit[] = [];
  for (const group of tagged.values())
    placed.push({
      name: (group.find((m) => m.script) ?? group[0]!).nickname || "Unit",
      side: 0,
      models: group,
      placed: true,
    });
  const named: TtsUnit[] = [];
  for (const [name, all] of byName)
    for (const group of clusters(all))
      named.push({ name: name || "Unit", side: 0, models: group, placed: true });
  placed.push(...withSergeants(named));
  const all = splitSides([...placed, ...units]);
  // Each army's units across the table, so they keep an order players recognise; bags last.
  return {
    title,
    terrain,
    ...(bundles.length ? { bundles } : {}),
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
/** A sergeant this close (centre to centre) to the squad named like it stands in it. */
const IN_SQUAD = 3;

/**
 * A squad's sergeant and champion, named apart in TTS ("Warden Sergeant" by
 * nine "Warden"), go back into the squad they stand in (PX TTS 3): a group
 * of one or two whose name starts with the squad's (plurals aside), in
 * coherency with it. Characters and leaders stay their own units, to lead
 * a squad by choice.
 */
function withSergeants(groups: TtsUnit[]): TtsUnit[] {
  const words = (n: string) =>
    n
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((w) => w.replace(/s$/, ""));
  const leads = (u: TtsUnit) => u.models.some((m) => /\b(leader|character)\b/i.test(m.description));
  const out = [...groups];
  for (const small of groups) {
    if (small.models.length > 2 || leads(small)) continue;
    const mine = words(small.name);
    const squad = out
      .filter((g) => g !== small && g.models.length > small.models.length)
      .find((g) => {
        const theirs = words(g.name);
        if (!theirs.length || theirs.length >= mine.length || !theirs.every((w, i) => mine[i] === w))
          return false;
        return small.models.some((a) =>
          g.models.some((b) => Math.hypot(a.pose.x - b.pose.x, a.pose.y - b.pose.y) <= IN_SQUAD),
        );
      });
    if (!squad) continue;
    squad.models = [...small.models, ...squad.models];
    out.splice(out.indexOf(small), 1);
  }
  return out;
}

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

/**
 * A terrain piece's tilt and uneven stretch in TTS as a row-major 3×3 matrix
 * for its OBJ's vertices, or undefined when it stands upright and evenly
 * scaled. Unity turns about z, then x, then y; the yaw stays the piece's
 * facing, so only x and z are baked, inside the mirroring TTS gives OBJs
 * as it loads them (N = diag(−1, 1, 1)): B = N·Rx·Rz·S·N, with S the stretch
 * left over once `scale` (the even part) is taken out.
 */
export function bakeOf(o: TtsObject, scale: number): number[] | undefined {
  const t = o.Transform ?? {};
  const deg = (v: number | undefined) => ((((v ?? 0) % 360) + 540) % 360) - 180;
  const ax = deg(t.rotX);
  const az = deg(t.rotZ);
  const stretch = [t.scaleX, t.scaleY, t.scaleZ].map((v) => Math.abs(v ?? 1) / scale);
  if (Math.abs(ax) < 1 && Math.abs(az) < 1 && stretch.every((v) => Math.abs(v - 1) < 0.02)) return undefined;
  const [cx, sx] = [Math.cos((ax * Math.PI) / 180), Math.sin((ax * Math.PI) / 180)];
  const [cz, sz] = [Math.cos((az * Math.PI) / 180), Math.sin((az * Math.PI) / 180)];
  // Rx·Rz
  const r = [
    [cz, -sz, 0],
    [cx * sz, cx * cz, -sx],
    [sx * sz, sx * cz, cx],
  ];
  // ·S, then N on both sides: an entry changes sign when exactly one of its row and column is x.
  return r.flatMap((row, i) =>
    row.map((v, j) => Math.round(v * stretch[j]! * ((i === 0) !== (j === 0) ? -1 : 1) * 1e4) / 1e4 || 0),
  );
}

/** An OBJ with every vertex put through a row-major 3×3 matrix (bakeOf). */
export function bakeObj(text: string, m: number[]): string {
  return text.replace(/^v\s+(\S+)\s+(\S+)\s+(\S+)/gm, (line, a: string, b: string, c: string) => {
    const v = [Number(a), Number(b), Number(c)];
    if (!v.every(Number.isFinite)) return line;
    const out = [0, 1, 2].map(
      (i) => +(m[i * 3]! * v[0]! + m[i * 3 + 1]! * v[1]! + m[i * 3 + 2]! * v[2]!).toFixed(5),
    );
    return `v ${out.join(" ")}`;
  });
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
