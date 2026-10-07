import type { BaseShape, WeaponProfile } from "../../core";
import type { ImportedRoster, ImportedUnit } from "../wh40k/roster";

/**
 * Two invented rank-and-flank armies for trying the regiment tools. Names and
 * numbers are made up; none come from any published army book.
 */

const FOOT: BaseShape = { shape: "rect", widthMm: 20, depthMm: 20 };
const BIG_FOOT: BaseShape = { shape: "rect", widthMm: 25, depthMm: 25 };
const HORSE: BaseShape = { shape: "rect", widthMm: 25, depthMm: 50 };
const BRUTE: BaseShape = { shape: "rect", widthMm: 40, depthMm: 40 };
const ENGINE: BaseShape = { shape: "rect", widthMm: 50, depthMm: 50 };

type Stats = Record<"M" | "WS" | "BS" | "S" | "T" | "W" | "I" | "A" | "Ld", number> & { US?: number };

const chars = (s: Stats): Record<string, string> =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)]));

/**
 * A regiment: rank and file plus optional command models and a character,
 * who stand at the front of the slot order (the front rank).
 */
function regiment(
  name: string,
  count: number,
  base: BaseShape,
  stats: Stats,
  points: number,
  extra: { name: string; stats: Stats; base?: BaseShape }[] = [],
  weapon?: { name: string; range: number; S?: number; AP?: number },
): ImportedUnit {
  const weapons: Record<string, WeaponProfile> = weapon
    ? {
        missile: {
          id: "missile",
          name: weapon.name,
          kind: "ranged" as const,
          chars: { Range: `${weapon.range}"`, S: String(weapon.S ?? 0), AP: String(weapon.AP ?? 0) },
          keywords: [],
        },
      }
    : {};
  const carried = weapon ? ["missile"] : [];
  const leaders = extra.map((e) => ({
    profile: { name: e.name, chars: chars(e.stats) },
    weapons: [],
    ...(e.base ? { base: e.base } : {}),
  }));
  const troops = Array.from({ length: count - extra.length }, () => ({
    profile: { name, chars: chars(stats) },
    weapons: carried,
  }));
  return {
    name,
    base,
    sheet: { weapons, abilities: [], keywords: [], points },
    models: [...leaders, ...troops],
  };
}

const spear: Stats = { M: 4, WS: 3, BS: 3, S: 3, T: 3, W: 1, I: 3, A: 1, Ld: 7 };
const bow: Stats = { ...spear, BS: 3 };
const rider: Stats = { M: 8, WS: 4, BS: 3, S: 3, T: 3, W: 1, I: 3, A: 1, Ld: 7, US: 2 };
const captain: Stats = { M: 4, WS: 5, BS: 4, S: 4, T: 4, W: 2, I: 5, A: 3, Ld: 9 };

function marchwardens(): ImportedRoster {
  const units = [
    regiment("Marchwarden Spears", 25, FOOT, spear, 150, [
      { name: "Warden Captain", stats: captain, base: BIG_FOOT },
      { name: "Spear Sergeant", stats: { ...spear, A: 2 } },
      { name: "Standard Bearer", stats: spear },
    ]),
    regiment("Fen Bowmen", 15, FOOT, bow, 120, [], { name: "Longbow", range: 30, S: 3 }),
    regiment("Riders of the Downs", 6, HORSE, rider, 130, [{ name: "Banner Rider", stats: rider }]),
    regiment(
      "Siege Engine",
      1,
      ENGINE,
      { M: 0, WS: 0, BS: 3, S: 7, T: 7, W: 3, I: 1, A: 0, Ld: 7, US: 3 },
      90,
    ),
  ];
  return { name: "Marchwarden Host", points: total(units), units, warnings: [] };
}

function reavers(): ImportedRoster {
  const brute: Stats = { M: 6, WS: 3, BS: 2, S: 4, T: 4, W: 3, I: 2, A: 3, Ld: 7, US: 3 };
  const raider: Stats = { M: 5, WS: 3, BS: 3, S: 3, T: 3, W: 1, I: 3, A: 1, Ld: 6 };
  const units = [
    regiment("Reaver Warband", 30, FOOT, raider, 160, [
      { name: "Reaver Chief", stats: { ...captain, Ld: 8 }, base: BIG_FOOT },
      { name: "Drummer", stats: raider },
    ]),
    regiment("Tusk Brutes", 6, BRUTE, brute, 210),
    regiment("Wolf Runners", 5, HORSE, { ...rider, M: 9, Ld: 6 }, 90),
    regiment("Reaver Slingers", 10, FOOT, raider, 60, [], { name: "Sling", range: 18, S: 3 }),
  ];
  return { name: "Reaver Horde", points: total(units), units, warnings: [] };
}

function total(units: ImportedUnit[]): number {
  return units.reduce((t, u) => t + (u.sheet.points ?? 0), 0);
}

/** A ready-made invented army: 0 = Marchwarden Host, 1 = Reaver Horde. */
export function towSample(variant: 0 | 1): ImportedRoster {
  return variant === 0 ? marchwardens() : reavers();
}
