import type { BaseShape } from "../../core";
import type { ImportedRoster, ImportedUnit } from "../wh40k/roster";

/**
 * Two invented Conquest-style armies of stands. Names and numbers are made
 * up; none come from any published list. Stand sizes are unverified guesses:
 * a 40mm square of four infantry, 50mm cavalry and brutes, 100mm monsters.
 */

const INFANTRY: BaseShape = { shape: "rect", widthMm: 40, depthMm: 40 };
const CAVALRY: BaseShape = { shape: "rect", widthMm: 50, depthMm: 50 };
const MONSTER: BaseShape = { shape: "rect", widthMm: 100, depthMm: 100 };

type Stats = Record<"M" | "V" | "C" | "A" | "W" | "R" | "D", number> & {
  E?: number;
  Barrage?: number;
  Range?: number;
  Cleave?: number;
  Support?: number;
  Type: "Infantry" | "Cavalry" | "Brute" | "Monster";
  Class: "Light" | "Medium" | "Heavy";
};

const chars = (s: Stats): Record<string, string> =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "Range" ? `${v}"` : String(v)]));

/** A regiment of `stands`, three wide (or fewer), the command stand first so it leads the front rank. */
function regiment(name: string, stands: number, stats: Stats, points: number): ImportedUnit {
  const base = stats.Type === "Infantry" ? INFANTRY : stats.Type === "Monster" ? MONSTER : CAVALRY;
  const models = Array.from({ length: stands }, (_, i) => ({
    profile: { name: i === 0 && stands > 1 ? `${name} command` : name, chars: chars(stats) },
    weapons: [],
  }));
  return {
    name,
    base,
    sheet: { weapons: {}, abilities: [], keywords: [stats.Type, stats.Class], points },
    models,
    files: Math.min(3, stands),
  };
}

function ironmarch(): ImportedRoster {
  const units = [
    regiment(
      "Shieldwall Spears",
      6,
      { M: 5, V: 1, C: 2, A: 4, W: 4, R: 2, D: 3, Support: 2, Type: "Infantry", Class: "Medium" },
      160,
    ),
    regiment(
      "Ironmarch Crossbows",
      3,
      { M: 5, V: 2, C: 1, A: 3, W: 4, R: 2, D: 2, Barrage: 2, Range: 24, Type: "Infantry", Class: "Light" },
      130,
    ),
    regiment(
      "Warden Guard",
      6,
      { M: 5, V: 1, C: 3, A: 5, W: 4, R: 3, D: 4, Cleave: 1, Type: "Infantry", Class: "Heavy" },
      210,
    ),
    regiment(
      "Iron Riders",
      3,
      { M: 8, V: 1, C: 3, A: 4, W: 4, R: 3, D: 4, Cleave: 1, Type: "Cavalry", Class: "Heavy" },
      190,
    ),
  ];
  return { name: "Ironmarch Compact", points: total(units), units, warnings: [] };
}

function ashen(): ImportedRoster {
  const units = [
    regiment(
      "Thrall Host",
      9,
      { M: 5, V: 0, C: 1, A: 4, W: 4, R: 1, D: 1, Type: "Infantry", Class: "Light" },
      120,
    ),
    regiment(
      "Bone Archers",
      3,
      { M: 5, V: 2, C: 1, A: 3, W: 4, R: 1, D: 1, Barrage: 2, Range: 20, Type: "Infantry", Class: "Light" },
      110,
    ),
    regiment(
      "Grave Hounds",
      4,
      { M: 9, V: 0, C: 3, A: 3, W: 5, R: 2, D: 2, E: 2, Type: "Brute", Class: "Medium" },
      170,
    ),
    regiment(
      "Ossuary Colossus",
      1,
      { M: 6, V: 0, C: 3, A: 9, W: 16, R: 4, D: 3, Cleave: 2, Type: "Monster", Class: "Heavy" },
      240,
    ),
  ];
  return { name: "Ashen Chorus", points: total(units), units, warnings: [] };
}

function total(units: ImportedUnit[]): number {
  return units.reduce((t, u) => t + (u.sheet.points ?? 0), 0);
}

/** A ready-made invented army: 0 = Ironmarch Compact, 1 = Ashen Chorus. */
export function conquestSample(variant: 0 | 1): ImportedRoster {
  return variant === 0 ? ironmarch() : ashen();
}
