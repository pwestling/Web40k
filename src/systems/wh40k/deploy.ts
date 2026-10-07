import {
  baseSizeInches,
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
  models: { profile: { name: string; chars: Characteristics }; weapons: string[] }[];
  base: BaseShape;
}

const GAP = 0.6;

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

/** Scan from the back edge inwards, left to right, for an empty rectangle. */
function findSpot(
  taken: { x: number; y: number; r: number }[],
  w: number,
  d: number,
  hx: number,
  hy: number,
  sign: number,
): { x: number; y: number } {
  for (let depth = d / 2 + 0.5; depth < hy; depth += 1) {
    for (let x = -hx + w / 2 + 0.5; x <= hx - w / 2 - 0.5; x += 1) {
      const y = sign * (hy - depth);
      const clear = taken.every(
        (t) => Math.abs(t.x - x) > w / 2 + t.r + GAP / 2 || Math.abs(t.y - y) > d / 2 + t.r + GAP / 2,
      );
      if (clear) return { x, y };
    }
  }
  return { x: 0, y: sign * (hy - d / 2) };
}
