import { baseSizeInches } from "./geometry";
import {
  footprintVisibility,
  inFootprint,
  segmentCrossesFootprint2D,
  modelHeight,
  segmentCrossesFootprint,
  segmentPointDistance2D,
  sightBlockedBy,
  standInHeight,
  type Vec3,
} from "./terrain";
import { opposed } from "./teams";
import type { GameState, Model, TerrainPiece, Vec2 } from "./types";

/**
 * True line of sight between model volumes: lines from points on the
 * observer to points on the target, stopped by terrain solids and, if the
 * table says so, other models. A model is a cylinder (or box, for hull
 * bases) of its base size and height.
 */

/** Points on the observer: its eye line, around the top of the model. */
function eyePoints(m: Model): Vec3[] {
  const { width, depth } = baseSizeInches(m.base);
  const r = Math.max(width, depth) / 2;
  const z = (m.z ?? 0) + modelHeight(m) * 0.9;
  const pts: Vec3[] = [{ x: m.position.x, y: m.position.y, z }];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    pts.push({ x: m.position.x + Math.cos(a) * r * 0.7, y: m.position.y + Math.sin(a) * r * 0.7, z });
  }
  return pts;
}

/** The model's shape as stacked cylinders: its imported bands, or one cylinder of base size. */
function bandsOf(m: Model): { rx: number; ry: number; z0: number; z1: number }[] {
  const { width, depth } = baseSizeInches(m.base);
  if (m.bands?.length) return m.bands.map((b) => ({ rx: b.r, ry: b.r, z0: b.z0, z1: b.z1 }));
  return [{ rx: width / 2, ry: depth / 2, z0: 0, z1: modelHeight(m) }];
}

/** Points over the target's volume: a column through its middle and two rings per band. */
function bodyPoints(m: Model): Vec3[] {
  if (m.bands?.length) {
    const z0 = m.z ?? 0;
    const pts: Vec3[] = [];
    for (const b of bandsOf(m)) {
      pts.push({ x: m.position.x, y: m.position.y, z: z0 + (b.z0 + b.z1) / 2 });
      for (const f of [0.25, 0.75]) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const z = z0 + b.z0 + (b.z1 - b.z0) * f;
          pts.push({
            x: m.position.x + Math.cos(a) * b.rx * 0.85,
            y: m.position.y + Math.sin(a) * b.ry * 0.85,
            z,
          });
        }
      }
    }
    return pts;
  }
  const { width, depth } = baseSizeInches(m.base);
  const rx = (width / 2) * 0.85;
  const ry = (depth / 2) * 0.85;
  const z0 = m.z ?? 0;
  const h = modelHeight(m);
  const pts: Vec3[] = [0.15, 0.5, 0.9].map((f) => ({ x: m.position.x, y: m.position.y, z: z0 + h * f }));
  for (const f of [0.25, 0.75]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push({ x: m.position.x + Math.cos(a) * rx, y: m.position.y + Math.sin(a) * ry, z: z0 + h * f });
    }
  }
  return pts;
}

/** A model's bands and how far from its axis a line can pass through them, kept per model. */
function volumeOf(m: Model): { bands: ReturnType<typeof bandsOf>; reach: number } {
  const was = volumes.get(m);
  if (was && was.base === m.base && was.from === m.bands && was.height === m.height) return was;
  const bands = bandsOf(m);
  const v = {
    base: m.base,
    from: m.bands,
    height: m.height,
    bands,
    reach: Math.max(...bands.map((x) => Math.min(x.rx, x.ry))) * 0.8,
  };
  volumes.set(m, v);
  return v;
}

const volumes = new WeakMap<
  Model,
  {
    base: Model["base"];
    from: Model["bands"];
    height: Model["height"];
    bands: ReturnType<typeof bandsOf>;
    reach: number;
  }
>();

/** Whether a line passes through a model's volume (approximated as an upright cylinder). */
function lineHitsModel(a: Vec3, b: Vec3, m: Model): boolean {
  const { bands, reach } = volumeOf(m);
  const dist = segmentPointDistance2D(a, b, m.position);
  if (dist > reach) return false;
  // Height of the line where it passes closest to the model's axis.
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = abx * abx + aby * aby;
  const t =
    len === 0 ? 0 : Math.max(0, Math.min(1, ((m.position.x - a.x) * abx + (m.position.y - a.y) * aby) / len));
  if (t < 0.02 || t > 0.98) return false;
  const z = a.z + (b.z - a.z) * t - (m.z ?? 0);
  return bands.some((x) => dist <= Math.min(x.rx, x.ry) * 0.8 && z >= x.z0 && z <= x.z1);
}

export interface Sight {
  /** Some part of the target can be seen. */
  visible: boolean;
  /** Every sampled part of the target can be seen. */
  fully: boolean;
  /** Share of the target's sampled points that can be seen. */
  fraction: number;
  /** Terrain pieces that hid at least part of the target. */
  obscuredBy: TerrainPiece[];
}

export interface SightOptions {
  /** Models that never block (the observer's own unit, the target). */
  ignore?: Set<string>;
  /** Whether models from other units block sight. */
  modelsBlock?: boolean;
}

/** Whether a model's vision arc (if the game has one) takes in a point. */
export function inVisionArc(state: GameState, observer: Model, p: { x: number; y: number }): boolean {
  const arc = state.settings.visionArc;
  if (!arc || arc >= 360) return true;
  // Facing 0 looks along +y; facing rotates the same way as the model's mesh.
  const fx = Math.sin(observer.facing);
  const fy = Math.cos(observer.facing);
  const dx = p.x - observer.position.x;
  const dy = p.y - observer.position.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const angle = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy) / len)));
  return angle <= ((arc / 2) * Math.PI) / 180 + 1e-9;
}

/**
 * The first piece blocking a line, each piece by its own sight mode: its
 * shape (true line of sight) or a block of its stand-in height. A stand-in
 * block never hides a model from inside it, nor blocks a model looking out.
 */
function lineBlockedBy(
  state: GameState,
  a: Vec3,
  b: Vec3,
  observer: Model,
  target: Model,
): TerrainPiece | null {
  const game = state.settings.los ?? "true";
  const shaped: TerrainPiece[] = [];
  for (const piece of state.terrain) {
    if ((piece.sight ?? game) === "true") {
      shaped.push(piece);
      continue;
    }
    if (inFootprint(piece, observer.position) || inFootprint(piece, target.position)) continue;
    if (segmentCrossesFootprint(piece, a, b, standInHeight(piece))) return piece;
  }
  return shaped.length ? sightBlockedBy(shaped, a, b) : null;
}

/** Whether another model can stand in the way between these two, by the game's blocking rules. */
function canBlock(state: GameState, observer: Model, target: Model, m: Model): boolean {
  const rule = state.settings.blockers;
  if (!rule) return true;
  if (rule.enemiesOnly && !opposed(state, m.owner, observer.owner)) return false;
  if (rule.tall?.length) {
    const tall = (x: Model) => {
      const kws = (x.unitId ? state.units[x.unitId]?.sheet?.keywords : undefined) ?? [];
      return kws.some((k) => rule.tall!.some((t) => t.toUpperCase() === k.toUpperCase()));
    };
    if (tall(target) && !tall(m)) return false;
  }
  return true;
}

/**
 * The terrain piece (or null) on each line from the observer's eyes to the
 * target's body points, body point by body point. The same two models standing
 * where they stood see past the same terrain: the bot and the game review ask
 * again for every table they try (perf/results.md, #63), so it is kept, by
 * terrain and by where and how big the two models are.
 */
function terrainLines(state: GameState, observer: Model, target: Model, eyes: Vec3[], body: Vec3[]) {
  let known = sightLines.get(state.terrain);
  if (!known || known.size > 10_000) sightLines.set(state.terrain, (known = new Map()));
  const key = `${state.settings.los ?? "true"}|${shapeKey(observer)}|${shapeKey(target)}`;
  let lines = known.get(key);
  if (!lines) {
    lines = body.flatMap((p) => eyes.map((e) => lineBlockedBy(state, e, p, observer, target)));
    known.set(key, lines);
  }
  return lines;
}

const sightLines = new WeakMap<TerrainPiece[], Map<string, (TerrainPiece | null)[]>>();
const bandIds = new WeakMap<object, number>();
let nextBands = 1;

/** What a model's eye and body points are made from: where it stands, its height, base and bands. */
function shapeKey(m: Model): string {
  const was = shapeKeys.get(m);
  if (
    was &&
    was.x === m.position.x &&
    was.y === m.position.y &&
    was.z === m.z &&
    was.base === m.base &&
    was.bands === m.bands &&
    was.height === m.height
  )
    return was.key;
  const key = makeShapeKey(m);
  shapeKeys.set(m, {
    x: m.position.x,
    y: m.position.y,
    z: m.z,
    base: m.base,
    bands: m.bands,
    height: m.height,
    key,
  });
  return key;
}

const shapeKeys = new WeakMap<
  Model,
  {
    x: number;
    y: number;
    z: Model["z"];
    base: Model["base"];
    bands: Model["bands"];
    height: Model["height"];
    key: string;
  }
>();

function makeShapeKey(m: Model): string {
  let bands = 0;
  if (m.bands?.length) {
    bands = bandIds.get(m.bands) ?? 0;
    if (!bands) bandIds.set(m.bands, (bands = nextBands++));
  }
  const b = m.base;
  const size = b.shape === "round" ? `${b.diameterMm}` : `${b.widthMm}x${b.depthMm}`;
  return `${m.position.x},${m.position.y},${m.z ?? 0},${modelHeight(m)},${b.shape}${size},${bands}`;
}

/** The models still on the table, in the table's order, kept per set of models (sight asks for every pair). */
function standingModels(state: GameState): Model[] {
  let list = standingIn.get(state.models);
  if (!list) standingIn.set(state.models, (list = Object.values(state.models).filter((m) => !m.destroyed)));
  return list;
}

const standingIn = new WeakMap<object, Model[]>();

export function modelSight(
  state: GameState,
  observer: Model,
  target: Model,
  options: SightOptions = {},
): Sight {
  if (!inVisionArc(state, observer, target.position))
    return { visible: false, fully: false, fraction: 0, obscuredBy: [] };
  if (state.settings.los === "heights") return heightsSight(state, observer, target, options);
  if (state.settings.los === "footprint") return footprintSight(state, observer, target, options);
  const eyes = eyePoints(observer);
  const body = bodyPoints(target);
  // Only models near the line between the two can be in the way: none outside its box grown by that much.
  const o = observer.position;
  const t = target.position;
  const [x0, x1, y0, y1] = [
    Math.min(o.x, t.x) - 4,
    Math.max(o.x, t.x) + 4,
    Math.min(o.y, t.y) - 4,
    Math.max(o.y, t.y) + 4,
  ];
  const blockers =
    options.modelsBlock === false
      ? []
      : standingModels(state).filter(
          (m) =>
            m.position.x >= x0 &&
            m.position.x <= x1 &&
            m.position.y >= y0 &&
            m.position.y <= y1 &&
            m.id !== observer.id &&
            m.id !== target.id &&
            !options.ignore?.has(m.id) &&
            // Only models near the line between the two can be in the way.
            segmentPointDistance2D(observer.position, target.position, m.position) < 4 &&
            canBlock(state, observer, target, m),
        );
  const terrain = terrainLines(state, observer, target, eyes, body);
  const obscured = new Set<TerrainPiece>();
  let seen = 0;
  for (let i = 0; i < body.length; i++) {
    const p = body[i]!;
    let clear = false;
    for (let j = 0; j < eyes.length; j++) {
      const e = eyes[j]!;
      const piece = terrain[i * eyes.length + j]!;
      if (piece) {
        obscured.add(piece);
        continue;
      }
      if (blockers.some((m) => lineHitsModel(e, p, m))) continue;
      clear = true;
      break;
    }
    if (clear) seen++;
  }
  return {
    visible: seen > 0,
    fully: seen === body.length,
    fraction: seen / body.length,
    obscuredBy: [...obscured],
  };
}

/**
 * Stand-in heights line of sight: lines from the top of the observer to the
 * top, middle and foot of the target. A terrain piece blocks a line that
 * passes over its footprint lower than its stand-in height, except a piece
 * either model stands in (models can see into and out of terrain they are in).
 * Other models block as cylinders of their height. Seeing any of the three
 * (in practice the top) makes the target visible; seeing all three means
 * fully visible, anything less counts as partly hidden for cover.
 */
function heightsSight(state: GameState, observer: Model, target: Model, options: SightOptions): Sight {
  const top = (m: Model) => (m.z ?? 0) + modelHeight(m);
  const eye: Vec3 = { x: observer.position.x, y: observer.position.y, z: top(observer) };
  const base = target.z ?? 0;
  const h = modelHeight(target);
  const points: Vec3[] = [top(target), base + h / 2, base + 0.05].map((z) => ({
    x: target.position.x,
    y: target.position.y,
    z,
  }));
  const blockers =
    options.modelsBlock === false
      ? []
      : Object.values(state.models).filter(
          (m) =>
            !m.destroyed &&
            m.id !== observer.id &&
            m.id !== target.id &&
            !options.ignore?.has(m.id) &&
            canBlock(state, observer, target, m) &&
            segmentPointDistance2D(observer.position, target.position, m.position) < 4,
        );
  const obscured = new Set<TerrainPiece>();
  let seen = 0;
  for (const p of points) {
    const piece = lineBlockedBy(state, eye, p, observer, target);
    if (piece) {
      obscured.add(piece);
      continue;
    }
    if (blockers.some((m) => lineHitsModel(eye, p, m))) continue;
    seen++;
  }
  return {
    visible: seen > 0,
    fully: seen === points.length,
    fraction: seen / points.length,
    obscuredBy: [...obscured],
  };
}

const baseRadius = (m: Model) => {
  const { width, depth } = baseSizeInches(m.base);
  return Math.max(width, depth) / 2;
};

/**
 * Footprint line of sight, heights ignored (Full Spectrum Dominance style):
 * - a point of the target's base is seen if the line from the centre of the
 *   observer's base reaches it without crossing a blocking piece (or, if the
 *   table says so, another model's base);
 * - the target is in cover if a blocking piece hides part of its base, or the
 *   line between the two centres crosses an obscuring piece; pieces touching
 *   the observer's base are ignored for cover but not for sight;
 * - a model on raised ground is out of sight from below unless its base
 *   touches the edge, and then it is in cover.
 * Models can see out of and into the piece they stand in.
 */
function footprintSight(state: GameState, observer: Model, target: Model, options: SightOptions): Sight {
  const none: Sight = { visible: false, fully: false, fraction: 0, obscuredBy: [] };
  const oz = observer.z ?? 0;
  const tz = target.z ?? 0;
  if (Math.abs(tz - oz) > 0.1) {
    const high = tz > oz ? target : observer;
    const ground = state.terrain.find((p) => inFootprint(p, high.position));
    if (!ground) return none;
    const atEdge = !inFootprint(ground, high.position, -baseRadius(high) - 0.05);
    return atEdge ? { visible: true, fully: false, fraction: 0.5, obscuredBy: [ground] } : none;
  }
  const r = baseRadius(target) * 0.95;
  const points: Vec2[] = [target.position];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    points.push({ x: target.position.x + Math.cos(a) * r, y: target.position.y + Math.sin(a) * r });
  }
  const between = state.terrain.filter(
    (p) => !inFootprint(p, observer.position) && !inFootprint(p, target.position),
  );
  const blocking = between.filter((p) => footprintVisibility(p) === "blocking");
  const bases =
    options.modelsBlock === false
      ? []
      : Object.values(state.models).filter(
          (m) =>
            !m.destroyed &&
            m.id !== observer.id &&
            m.id !== target.id &&
            !options.ignore?.has(m.id) &&
            canBlock(state, observer, target, m),
        );
  const obscured = new Set<TerrainPiece>();
  let seen = 0;
  for (const p of points) {
    const wall = blocking.find((t) => segmentCrossesFootprint2D(t, observer.position, p));
    if (wall) {
      obscured.add(wall);
      continue;
    }
    if (bases.some((m) => crossesBase(observer.position, p, m))) continue;
    seen++;
  }
  // Obscuring terrain between the centres gives cover, unless it touches the observer's base.
  const reach = baseRadius(observer);
  for (const p of state.terrain) {
    if (footprintVisibility(p) !== "obscuring" || inFootprint(p, observer.position, reach)) continue;
    if (segmentCrossesFootprint2D(p, observer.position, target.position)) obscured.add(p);
  }
  const covered = [...obscured].some((p) => footprintVisibility(p) === "obscuring");
  return {
    visible: seen > 0,
    fully: seen === points.length && !covered,
    fraction: seen / points.length,
    obscuredBy: [...obscured],
  };
}

/** Whether a line across the table passes over another model's base (not just touching its ends). */
function crossesBase(a: Vec2, b: Vec2, m: Model): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = abx * abx + aby * aby;
  if (len === 0) return false;
  const t = ((m.position.x - a.x) * abx + (m.position.y - a.y) * aby) / len;
  if (t < 0.02 || t > 0.98) return false;
  return segmentPointDistance2D(a, b, m.position) < baseRadius(m) * 0.8;
}

/**
 * Whether the table's terrain blocks a line between two points, under the
 * game's line-of-sight rules, models aside: for the pre-game sightline view
 * (#28), which is about the table, not any unit. True LOS uses each piece's
 * shape, stand-in heights its block (unless an end is inside it), footprint
 * LOS any blocking piece the line crosses (unless an end is inside it).
 */
export function terrainBlocksLine(state: GameState, a: Vec3, b: Vec3): boolean {
  const game = state.settings.los ?? "true";
  const shaped: TerrainPiece[] = [];
  for (const piece of state.terrain) {
    if (inFootprint(piece, a) || inFootprint(piece, b)) {
      if (game === "footprint" || (piece.sight ?? game) !== "true") continue;
    }
    if (game === "footprint") {
      if (footprintVisibility(piece) === "blocking" && segmentCrossesFootprint2D(piece, a, b)) return true;
      continue;
    }
    if ((piece.sight ?? game) === "true") shaped.push(piece);
    else if (segmentCrossesFootprint(piece, a, b, standInHeight(piece))) return true;
  }
  return shaped.length > 0 && sightBlockedBy(shaped, a, b) !== null;
}
