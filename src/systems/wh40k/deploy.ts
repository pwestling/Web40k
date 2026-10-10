import { teamShare } from "../../core/teams";
import {
  baseSizeInches,
  blockOffsets,
  rotate,
  type BaseShape,
  type Characteristics,
  type GameState,
  type Intent,
  type Model,
  type PlayerId,
  type StandInLook,
  type Unit,
  type UnitSheet,
  type Vec2,
} from "../../core";

/** What the importer produces for one unit (see roster.ts). */
export interface SpawnableUnit {
  name: string;
  sheet: UnitSheet;
  models: {
    profile: { name: string; chars: Characteristics };
    weapons: string[];
    base?: BaseShape;
    look?: StandInLook;
    height?: number;
    at?: { x: number; y: number; facing: number };
  }[];
  base: BaseShape;
  /** Deploy as a ranked block this many models wide (rank-and-flank games). */
  files?: number;
  /** Put into reserves once added (ImportedUnit.reserve). */
  reserve?: boolean;
}

/**
 * An army's own colour for the player deploying it (a faction's, Rift Lanterns
 * playtest): figures in the faction's colour stand on bases in the same one.
 * Not when another player already has that colour.
 */
export function armyColor(state: GameState, owner: PlayerId, color: string | undefined): Intent | null {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color) || !state.players[owner]) return null;
  const want = color.toLowerCase();
  if (state.players[owner]!.color.toLowerCase() === want) return null;
  if (Object.values(state.players).some((p) => p.id !== owner && p.color.toLowerCase() === want)) return null;
  return { type: "player/color", player: owner, color: want };
}

const GAP = 0.6;
/** How far ranked blocks deploy in from the table edge, and the space kept between them. */
const BLOCK_INSET = 3;
const BLOCK_GAP = 2;

/**
 * Turn imported units into unit/add intents, placed in tidy blocks inside
 * the owner's deployment zone (or along their table edge), clear of models
 * already on the table. Players then drag them where they want them.
 */
export function spawnIntents(
  state: GameState,
  owner: PlayerId,
  units: SpawnableUnit[],
  idPrefix: string,
  army?: string,
  /** Models with `at` stand exactly there, never turned: a TTS table opened as a game, whose armies are already placed (UX 477). */
  keepPlaces = false,
): Intent[] {
  const seat = state.players[owner]?.seat ?? 0;
  const sign = seat === 0 ? 1 : -1;
  const hx = state.table.width / 2;
  const hy = state.table.depth / 2;
  const zone = state.zones.find((z) => z.seat === seat)?.points;
  // A teammate's units start in their own slice of the side's zone.
  const share = teamShare(state, owner);
  const taken: { x: number; y: number; r: number }[] = Object.values(state.models)
    .filter((m) => !m.destroyed)
    .map((m) => {
      const s = baseSizeInches(m.base);
      return { x: m.position.x, y: m.position.y, r: Math.max(s.width, s.depth) / 2 };
    });

  // Models that bring where they stood (a TTS table, #73) stand there, turned through the centre
  // when the whole army stood on the other side's half. An army along a short edge spans both halves
  // and stays where it was (UX 473). A table opened as a game keeps every place (UX 477).
  const stood = units.flatMap((u) => (u.files ? [] : u.models.flatMap((m) => (m.at ? [m.at] : []))));
  const flip = !keepPlaces && stood.length > 0 && stood.every((a) => sign * a.y < 0);
  const standing = (at: { x: number; y: number; facing: number }) =>
    flip
      ? { position: { x: -at.x, y: -at.y }, facing: at.facing + Math.PI }
      : { position: { x: at.x, y: at.y }, facing: at.facing };

  const adds: Intent[] = units.map((u, ui) => {
    // Spread across the zone: each unit looks first at its own share of the width.
    const where: Where = { hx, hy, sign, zone, prefer: (share.index + (ui + 0.5) / units.length) / share.of };
    if (u.files) return blockIntent(u, u.files, owner, seat, `${idPrefix}-${ui}`, taken, where, army);
    if (u.models.length && u.models.every((m) => m.at)) {
      const unitId = `${idPrefix}-${ui}`;
      const models: Model[] = u.models.map((m, i) => ({
        id: `${unitId}-${i}`,
        owner,
        label: m.profile.name,
        ...standing(m.at!),
        base: m.base ?? u.base,
        profile: m.profile,
        weapons: m.weapons,
        ...(m.look ? { look: m.look } : {}),
        ...(m.height ? { height: m.height } : {}),
      }));
      for (const m of models) {
        const s = baseSizeInches(m.base);
        taken.push({ x: m.position.x, y: m.position.y, r: Math.max(s.width, s.depth) / 2 });
      }
      const unit: Unit = {
        id: unitId,
        owner,
        name: u.name,
        modelIds: [],
        formation: { kind: "skirmish" },
        sheet: u.sheet,
        ...(army ? { army } : {}),
      };
      return { type: "unit/add", unit, models } satisfies Intent;
    }
    const size = baseSizeInches(u.base);
    const step = Math.max(size.width, size.depth) + GAP;
    const perRow = Math.max(1, Math.min(u.models.length, 5));
    const rows = Math.ceil(u.models.length / perRow);
    const blockW = perRow * step;
    const blockD = rows * step;
    const spot = findSpot(taken, blockW, blockD, where);
    const unitId = `${idPrefix}-${ui}`;
    const models: Model[] = u.models.map((m, i) => {
      const x = spot.x - blockW / 2 + step * ((i % perRow) + 0.5);
      // Rows run from the table edge inwards.
      const y = spot.y + sign * (blockD / 2 - step * (Math.floor(i / perRow) + 0.5));
      taken.push({ x, y, r: step / 2 });
      return {
        id: `${unitId}-${i}`,
        owner,
        label: m.profile.name,
        position: { x, y },
        facing: seat === 0 ? Math.PI : 0,
        base: m.base ?? u.base,
        profile: m.profile,
        weapons: m.weapons,
        ...(m.look ? { look: m.look } : {}),
        ...(m.height ? { height: m.height } : {}),
      };
    });
    const unit: Unit = {
      id: unitId,
      owner,
      name: u.name,
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: u.sheet,
      ...(army ? { army } : {}),
    };
    return { type: "unit/add", unit, models } satisfies Intent;
  });
  // A unit that starts off the table (a TTS unit still in its bag, PX TTS 3) goes into reserves once it's added.
  return adds.flatMap((intent, ui) =>
    units[ui]!.reserve
      ? [intent, { type: "unit/reserve", id: `${idPrefix}-${ui}`, reserve: true } satisfies Intent]
      : [intent],
  );
}

/**
 * A ranked block `files` wide, front rank towards the enemy, in the first
 * clear spot from the owner's table edge. Models keep their order, so
 * characters and command models listed first stand in the front rank.
 */
function blockIntent(
  u: SpawnableUnit,
  files: number,
  owner: PlayerId,
  seat: number,
  unitId: string,
  taken: { x: number; y: number; r: number }[],
  where: Where,
  army?: string,
): Intent {
  const bases = u.models.map((m) => m.base ?? u.base);
  const f = Math.max(1, Math.min(Math.floor(files), bases.length));
  const offsets = blockOffsets(bases, f);
  const sizes = bases.map(baseSizeInches);
  const width = Math.max(...offsets.map((o, i) => Math.abs(o.x) + sizes[i]!.width / 2)) * 2;
  const depth = Math.max(...offsets.map((o, i) => -o.y + sizes[i]!.depth / 2));
  // Blocks start a few inches in from the edge with room between them to wheel.
  const spot = findSpot(taken, width, depth, where, BLOCK_INSET, BLOCK_GAP);
  // Seat 0 sits on the +y edge and faces -y (facing pi); seat 1 the other way.
  const facing = seat === 0 ? Math.PI : 0;
  const back = rotate({ x: 0, y: depth / 2 }, facing);
  const front = { x: spot.x + back.x, y: spot.y + back.y };
  const models: Model[] = u.models.map((m, i) => {
    const o = rotate(offsets[i]!, facing);
    const size = sizes[i]!;
    taken.push({ x: front.x + o.x, y: front.y + o.y, r: Math.max(size.width, size.depth) / 2 });
    return {
      id: `${unitId}-${i}`,
      owner,
      label: m.profile.name,
      position: { x: front.x + o.x, y: front.y + o.y },
      facing,
      base: bases[i]!,
      profile: m.profile,
      weapons: m.weapons,
      ...(m.look ? { look: m.look } : {}),
      ...(m.height ? { height: m.height } : {}),
    };
  });
  const unit: Unit = {
    id: unitId,
    owner,
    name: u.name,
    modelIds: [],
    formation: { kind: "ranked", files: f, order: "close" },
    sheet: u.sheet,
    ...(army ? { army } : {}),
  };
  return { type: "unit/add", unit, models } satisfies Intent;
}

/**
 * Scan from the back edge inwards, left to right, for an empty rectangle:
 * inside the deployment zone when there is one and the unit fits in it,
 * else anywhere on the owner's half.
 */
/** How deep a side's setup strip is when the game has no deployment zones. */
const NO_ZONE_DEPTH = 12;

function findSpot(
  taken: { x: number; y: number; r: number }[],
  w: number,
  d: number,
  { hx, hy, sign, zone, prefer }: Where,
  inset = 0.5,
  gap = GAP / 2,
): { x: number; y: number } {
  // Across a row, nearest the preferred spot first.
  const across = (lo: number, hi: number, step: number) => {
    const xs: number[] = [];
    for (let x = lo; x <= hi; x += step) xs.push(x);
    const want = lo + (hi - lo) * prefer;
    return xs.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
  };
  const clear = (x: number, y: number) =>
    taken.every((t) => Math.abs(t.x - x) > w / 2 + t.r + gap || Math.abs(t.y - y) > d / 2 + t.r + gap);
  if (zone && zone.length >= 3) {
    const xs = zone.map((p) => p.x);
    const ys = zone.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Corners and edge midpoints, kept a little in from the zone's line.
    const fits = (x: number, y: number) => {
      const a = w / 2 + 0.1;
      const b = d / 2 + 0.1;
      return [-1, 0, 1].every((i) =>
        [-1, 0, 1].every((j) => insidePolygon({ x: x + i * a, y: y + j * b }, zone)),
      );
    };
    // From the zone's front row back towards the table edge, so the armies start within reach of
    // each other, as players set up (#56: the back rows left them 35" apart).
    for (let k = d / 2 + inset; k <= y1 - y0 - d / 2; k += 0.5) {
      const y = sign > 0 ? y0 + k : y1 - k;
      for (const x of across(x0 + w / 2 + inset, x1 - w / 2 - inset, 0.5))
        if (fits(x, y) && clear(x, y)) return { x, y };
    }
  }
  // No zone (no mission): a 12" strip along the player's edge, filled from its front row back.
  const front = Math.max(d / 2 + inset, hy - NO_ZONE_DEPTH);
  for (let y0 = front; y0 < hy; y0 += 1) {
    const y = sign * Math.min(y0 + d / 2, hy - d / 2 - inset);
    for (const x of across(-hx + w / 2 + inset, hx - w / 2 - inset, 1)) if (clear(x, y)) return { x, y };
  }
  for (let depth = d / 2 + inset; depth < hy; depth += 1) {
    for (const x of across(-hx + w / 2 + inset, hx - w / 2 - inset, 1)) {
      const y = sign * (hy - depth);
      if (clear(x, y)) return { x, y };
    }
  }
  return { x: 0, y: sign * (hy - d / 2) };
}

/** Where a unit may go: the table's half-size, the owner's side and zone, and a preferred share (0-1) of the width. */
interface Where {
  hx: number;
  hy: number;
  sign: number;
  zone: Vec2[] | undefined;
  prefer: number;
}

/** Whether a point lies inside a polygon (even-odd rule). */
function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
