import type { Ability, BaseShape, Spell, WeaponProfile } from "../../core";
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

type Stats = Record<"M" | "WS" | "BS" | "S" | "T" | "W" | "I" | "A" | "Ld", number> & {
  US?: number;
  Troop?: string;
};

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
  more: { rules?: string[]; keywords?: string[]; wizard?: number; spells?: Spell[] } = {},
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
    sheet: {
      weapons,
      abilities: (more.rules ?? []).map((name): Ability => ({ name, text: "", group: "Special rules" })),
      keywords: more.keywords ?? [],
      points,
      ...(more.wizard ? { wizard: more.wizard, spells: more.spells ?? [] } : {}),
    },
    models: [...leaders, ...troops],
  };
}

const spear: Stats = { M: 4, WS: 3, BS: 3, S: 3, T: 3, W: 1, I: 3, A: 1, Ld: 7, Troop: "Regular Infantry" };
const bow: Stats = { ...spear, BS: 3 };
const rider: Stats = {
  M: 8,
  WS: 4,
  BS: 3,
  S: 3,
  T: 3,
  W: 1,
  I: 3,
  A: 1,
  Ld: 7,
  US: 2,
  Troop: "Light Cavalry",
};
const seer: Stats = { M: 4, WS: 3, BS: 3, S: 3, T: 3, W: 2, I: 3, A: 1, Ld: 8, Troop: "Regular Infantry" };

/** Invented spells (names and numbers made up for Open Battle). */
const HEDGE_LORE: Spell[] = [
  { name: "Spark Lance", cv: 8, range: 18, kind: "missile", hits: "D6", strength: 4, lore: "Hedge" },
  { name: "Ward of Thorns", cv: 7, range: 12, kind: "enchantment", lore: "Hedge" },
  { name: "Mire Step", cv: 6, range: 12, kind: "conveyance", lore: "Hedge" },
];
const BONE_LORE: Spell[] = [
  { name: "Bone Hail", cv: 7, range: 18, kind: "missile", hits: "D6", strength: 3, lore: "Bone" },
  { name: "Leaden Limbs", cv: 8, range: 18, kind: "hex", remains: true, lore: "Bone" },
  { name: "Gnashing Maw", cv: 6, range: 1, kind: "assailment", hits: "2D6", strength: 3, lore: "Bone" },
];

const captain: Stats = { M: 4, WS: 5, BS: 4, S: 4, T: 4, W: 2, I: 5, A: 3, Ld: 9, Troop: "Regular Infantry" };

function marchwardens(): ImportedRoster {
  const units = [
    regiment(
      "Marchwarden Spears",
      25,
      FOOT,
      spear,
      150,
      [
        { name: "Warden Captain", stats: captain, base: BIG_FOOT },
        { name: "Spear Sergeant", stats: { ...spear, A: 2 } },
        // Carries the army's Battle Standard: units near it re-roll failed Leadership tests.
        { name: "Battle Standard Bearer", stats: spear },
        { name: "Hedge Seer", stats: seer },
      ],
      undefined,
      { keywords: ["General"], wizard: 2, spells: HEDGE_LORE },
    ),
    regiment("Fen Bowmen", 15, FOOT, bow, 120, [], { name: "Longbow", range: 30, S: 3 }),
    regiment(
      "Riders of the Downs",
      6,
      HORSE,
      rider,
      130,
      [
        { name: "Downs Champion", stats: { ...rider, A: 2 } },
        { name: "Banner Rider", stats: rider },
      ],
      undefined,
      {
        rules: ["Hatred"],
      },
    ),
    regiment(
      "Siege Engine",
      1,
      ENGINE,
      { M: 0, WS: 0, BS: 3, S: 7, T: 7, W: 3, I: 1, A: 0, Ld: 7, US: 3, Troop: "War Machine" },
      90,
    ),
  ];
  return { name: "Marchwarden Host", points: total(units), units, warnings: [] };
}

function reavers(): ImportedRoster {
  const brute: Stats = {
    M: 6,
    WS: 3,
    BS: 2,
    S: 4,
    T: 4,
    W: 3,
    I: 2,
    A: 3,
    Ld: 7,
    US: 3,
    Troop: "Monstrous Infantry",
  };
  const raider: Stats = {
    M: 5,
    WS: 3,
    BS: 3,
    S: 3,
    T: 3,
    W: 1,
    I: 3,
    A: 1,
    Ld: 6,
    Troop: "Regular Infantry",
  };
  const units = [
    regiment(
      "Reaver Warband",
      30,
      FOOT,
      raider,
      160,
      [
        { name: "Reaver Chief", stats: { ...captain, Ld: 8 }, base: BIG_FOOT },
        { name: "Drummer", stats: raider },
        { name: "Bone Shaman", stats: { ...seer, Ld: 7 } },
      ],
      undefined,
      { keywords: ["General"], wizard: 1, spells: BONE_LORE },
    ),
    regiment(
      "Tusk Brutes",
      6,
      BRUTE,
      brute,
      210,
      [{ name: "Brute Boss", stats: { ...brute, A: 4 } }],
      undefined,
      {
        rules: ["Fear", "Stubborn"],
      },
    ),
    regiment(
      "Wolf Runners",
      5,
      HORSE,
      { ...rider, M: 9, Ld: 6 },
      90,
      [{ name: "Pack Leader", stats: { ...rider, M: 9, Ld: 6, A: 2 } }],
      undefined,
      { rules: ["Frenzy"] },
    ),
    // A lone, dim-witted monster: it causes Terror and tests for Stupidity each turn.
    regiment(
      "Bog Hulk",
      1,
      BRUTE,
      { M: 6, WS: 3, BS: 0, S: 5, T: 5, W: 5, I: 1, A: 4, Ld: 4, US: 5, Troop: "Monster" },
      120,
      [],
      undefined,
      { rules: ["Terror", "Stupidity"] },
    ),
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
