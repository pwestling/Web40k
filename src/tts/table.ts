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
  /** 0: the +y half (seat 0's side), 1: the −y half. */
  side: 0 | 1;
  models: TtsThing[];
  /** On the table where they stand, or still in a bag (deployed as usual). */
  placed: boolean;
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
      side: pose.y >= 0 ? 0 : 1,
      models: inside,
      placed: false,
    });
  }
  // Figures standing on the table: by name, then into groups standing together.
  const byName = new Map<string, TtsThing[]>();
  for (const t of loose) byName.set(t.nickname, [...(byName.get(t.nickname) ?? []), t]);
  const placed: TtsUnit[] = [];
  for (const [name, all] of byName)
    for (const group of clusters(all)) {
      const y = group.reduce((s, m) => s + m.pose.y, 0) / group.length;
      placed.push({ name: name || "Unit", side: y >= 0 ? 0 : 1, models: group, placed: true });
    }
  // Across the table from the near edge, so an army's units keep an order players recognise.
  placed.sort((a, b) => a.side - b.side || centreX(a) - centreX(b));
  return { title, terrain, units: [...placed, ...units] };
}

const centreX = (u: TtsUnit) => u.models.reduce((s, m) => s + m.pose.x, 0) / u.models.length;

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
  return {
    ...table,
    terrain: table.terrain.map(turn),
    units: table.units.map((u) => {
      const models = u.models.map(turn);
      if (!u.placed) return { ...u, models };
      const y = models.reduce((sum, m) => sum + m.pose.y, 0) / models.length;
      return { ...u, models, side: y >= 0 ? 0 : 1 };
    }),
  };
}
