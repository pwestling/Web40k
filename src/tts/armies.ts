import { systemOf } from "../core/content/turn";
import type { ShelfFigure } from "../packages/shelf";
import type { ImportedModel, ImportedRoster, ImportedUnit } from "../systems/wh40k/roster";
import { unitFromTts } from "./profiles";
import { baseFor, placeOnTable, type TtsTable, type TtsThing } from "./table";

/** What the importer made of one TTS model: its asset, and the size it came in at. */
export interface TtsAsset {
  id: string;
  name: string;
  /** Footprint and height, inches. */
  width: number;
  depth: number;
  height: number;
  /** The middle of the OBJ's footprint in its own units (objCentre). */
  centre: [number, number, number];
}

interface TtsArmy {
  side: 0 | 1;
  roster: ImportedRoster;
  /** As on a shelf army: by unit index, then profile name. */
  figures: Record<number, Record<string, ShelfFigure>>;
}

/**
 * The armies on a TTS table (#73), one per half: each unit's models with
 * their figures, standing where TTS had them (`at`), or deployed as usual
 * when they were still in a bag. Stats come from the descriptions when the
 * profile reader can read them (#74); otherwise names only, to fill in. A
 * model whose files never came stays as a stand-in on a plain base (UX 475).
 */
export function ttsArmies(
  table: TtsTable,
  assets: Map<string, TtsAsset>,
  system: string,
  name: (side: 0 | 1) => string,
): TtsArmy[] {
  const blank = systemOf({ system })
    .characteristics.filter((c) => c.of === "model" && c.default === undefined)
    .map((c) => c.id);
  const out: TtsArmy[] = [];
  for (const side of [0, 1] as const) {
    const units = table.units.filter((u) => u.side === side && u.models.length);
    if (!units.length) continue;
    const roster: ImportedRoster = { name: name(side), units: [], warnings: [] };
    const figures: TtsArmy["figures"] = {};
    for (const u of units) {
      const things = u.models;
      const read = unitFromTts({
        system,
        name: u.name,
        models: things.map((m) => ({ nickname: m.nickname, description: m.description })),
      });
      const models: ImportedModel[] = things.map((m, i) => {
        const a = assets.get(m.key);
        const own = read?.models?.[i];
        const height = own?.height ?? (a ? Math.round(a.height * 10) / 10 : undefined);
        return {
          profile: own?.profile ?? { name: m.nickname || u.name, chars: {} },
          weapons: own?.weapons ?? [],
          base: own?.base ?? (a ? baseFor(a.width, a.depth) : STAND_IN_BASE),
          ...(height ? { height } : {}),
          ...(u.placed ? { at: placeOnTable(m.pose, a?.centre ?? [0, 0, 0], m.scale) } : {}),
        };
      });
      const unit: ImportedUnit = {
        name: read?.name ?? u.name,
        sheet: read?.sheet ?? { weapons: {}, abilities: [], keywords: [] },
        models,
        base: models[0]!.base!,
        ...(read ? (read.missing?.length ? { missing: read.missing } : {}) : { missing: blank }),
      };
      const index = roster.units.length;
      roster.units.push(unit);
      figures[index] = dress(things, models, assets);
    }
    out.push({ side, roster, figures });
  }
  return out;
}

/** A model whose files never came: the common infantry base. */
const STAND_IN_BASE = { shape: "round", diameterMm: 32 } as const;

/** Each profile wears the figure most of its models had in TTS. */
function dress(
  things: TtsThing[],
  models: ImportedModel[],
  assets: Map<string, TtsAsset>,
): Record<string, ShelfFigure> {
  const tally = new Map<string, Map<string, number>>();
  models.forEach((m, i) => {
    const id = assets.get(things[i]!.key)?.id;
    if (!id) return;
    const by = tally.get(m.profile.name) ?? new Map<string, number>();
    by.set(id, (by.get(id) ?? 0) + 1);
    tally.set(m.profile.name, by);
  });
  const out: Record<string, ShelfFigure> = {};
  for (const [profile, by] of tally) {
    const id = [...by.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const a = [...assets.values()].find((x) => x.id === id)!;
    out[profile] = { figure: { asset: id, name: a.name, yaw: 0, scale: 1 } };
  }
  return out;
}
