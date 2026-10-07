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
  type Unit,
  type UnitSheet,
} from "../../core";

/** What the importer produces for one unit (see roster.ts). */
export interface SpawnableUnit {
  name: string;
  sheet: UnitSheet;
  models: { profile: { name: string; chars: Characteristics }; weapons: string[]; base?: BaseShape }[];
  base: BaseShape;
  /** Deploy as a ranked block this many models wide (rank-and-flank games). */
  files?: number;
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
): Intent[] {
  const seat = state.players[owner]?.seat ?? 0;
  const sign = seat === 0 ? 1 : -1;
  const hx = state.table.width / 2;
  const hy = state.table.depth / 2;
  const taken: { x: number; y: number; r: number }[] = Object.values(state.models)
    .filter((m) => !m.destroyed)
    .map((m) => {
      const s = baseSizeInches(m.base);
      return { x: m.position.x, y: m.position.y, r: Math.max(s.width, s.depth) / 2 };
    });

  return units.map((u, ui) => {
    if (u.files) return blockIntent(u, u.files, owner, seat, `${idPrefix}-${ui}`, taken, hx, hy, sign, army);
    const size = baseSizeInches(u.base);
    const step = Math.max(size.width, size.depth) + GAP;
    const perRow = Math.max(1, Math.min(u.models.length, 5));
    const rows = Math.ceil(u.models.length / perRow);
    const blockW = perRow * step;
    const blockD = rows * step;
    const spot = findSpot(taken, blockW, blockD, hx, hy, sign);
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
        base: u.base,
        profile: m.profile,
        weapons: m.weapons,
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
  hx: number,
  hy: number,
  sign: number,
  army?: string,
): Intent {
  const bases = u.models.map((m) => m.base ?? u.base);
  const f = Math.max(1, Math.min(Math.floor(files), bases.length));
  const offsets = blockOffsets(bases, f);
  const sizes = bases.map(baseSizeInches);
  const width = Math.max(...offsets.map((o, i) => Math.abs(o.x) + sizes[i]!.width / 2)) * 2;
  const depth = Math.max(...offsets.map((o, i) => -o.y + sizes[i]!.depth / 2));
  // Blocks start a few inches in from the edge with room between them to wheel.
  const spot = findSpot(taken, width, depth, hx, hy, sign, BLOCK_INSET, BLOCK_GAP);
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

/** Scan from the back edge inwards, left to right, for an empty rectangle. */
function findSpot(
  taken: { x: number; y: number; r: number }[],
  w: number,
  d: number,
  hx: number,
  hy: number,
  sign: number,
  inset = 0.5,
  gap = GAP / 2,
): { x: number; y: number } {
  for (let depth = d / 2 + inset; depth < hy; depth += 1) {
    for (let x = -hx + w / 2 + inset; x <= hx - w / 2 - inset; x += 1) {
      const y = sign * (hy - depth);
      const clear = taken.every(
        (t) => Math.abs(t.x - x) > w / 2 + t.r + gap || Math.abs(t.y - y) > d / 2 + t.r + gap,
      );
      if (clear) return { x, y };
    }
  }
  return { x: 0, y: sign * (hy - d / 2) };
}
