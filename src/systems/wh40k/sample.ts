/**
 * Two small invented armies for trying the table without importing a list.
 * Every name, number and ability text here is made up for Open Battle.
 */
import {
  suggestBase,
  type Ability,
  type Characteristics,
  type ImportedModel,
  type ImportedRoster,
  type ImportedUnit,
  type WeaponProfile,
} from "./roster";

type W = Omit<WeaponProfile, "id" | "keywords"> & { keywords?: string[] };

function weapon(name: string, kind: "ranged" | "melee", chars: Characteristics, keywords: string[] = []): W {
  return { name, kind, chars, keywords };
}

function ranged(
  name: string,
  range: string,
  a: string,
  bs: string,
  s: string,
  ap: string,
  d: string,
  kw?: string[],
) {
  return weapon(name, "ranged", { RANGE: range, A: a, BS: bs, S: s, AP: ap, D: d }, kw);
}

function melee(name: string, a: string, ws: string, s: string, ap: string, d: string, kw?: string[]) {
  return weapon(name, "melee", { RANGE: "Melee", A: a, WS: ws, S: s, AP: ap, D: d }, kw);
}

function stats(
  m: string,
  t: string,
  sv: string,
  w: string,
  ld: string,
  oc: string,
  inv?: string,
): Characteristics {
  const c: Characteristics = { M: m, T: t, SV: sv, W: w, LD: ld, OC: oc };
  if (inv) c.INV = inv;
  return c;
}

interface Group {
  profile: string;
  chars: Characteristics;
  count: number;
  /** Weapons every model in the group carries. */
  weapons: W[];
  /** Per-model extras, by model index within the group. */
  extra?: Record<number, W[]>;
}

function unit(
  name: string,
  keywords: string[],
  points: number,
  abilities: Ability[],
  groups: Group[],
): ImportedUnit {
  const weapons: Record<string, WeaponProfile> = {};
  const keyOf = (w: W) => {
    const id = `${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${w.kind}`;
    weapons[id] ??= { id, name: w.name, kind: w.kind, chars: w.chars, keywords: w.keywords ?? [] };
    return id;
  };
  const models: ImportedModel[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.count; i++) {
      models.push({
        profile: { name: g.profile, chars: { ...g.chars } },
        weapons: [...g.weapons, ...(g.extra?.[i] ?? [])].map(keyOf),
      });
    }
  }
  const sheet = { weapons, abilities, keywords, points };
  return { name, sheet, models, base: suggestBase({ sheet, models }) };
}

function vanguardLegion(): ImportedRoster {
  const rifle = ranged("Pattern Rifle", '24"', "2", "3+", "4", "0", "1", ["Rapid Fire 1"]);
  const knife = melee("Combat Knife", "3", "3+", "4", "0", "1");
  const lance = ranged("Arc Lance", '36"', "1", "4+", "9", "-3", "D6+1", ["Heavy", "Devastating Wounds"]);
  const flamer = ranged("Ember Projector", '12"', "D6", "N/A", "5", "-1", "1", ["Torrent", "Ignores Cover"]);
  const meltagun = ranged("Fusion Caster", '12"', "1", "3+", "9", "-4", "D6", ["Melta 2"]);

  const troopers = unit(
    "Line Troopers",
    ["Infantry", "Battleline", "Vanguard Legion"],
    90,
    [
      {
        name: "Hold the Line",
        text: "While this unit is within range of an objective, add 1 to its Leadership.",
      },
    ],
    [
      {
        profile: "Line Sergeant",
        chars: stats('6"', "4", "3+", "2", "6+", "2"),
        count: 1,
        weapons: [ranged("Service Pistol", '12"', "1", "3+", "4", "0", "1", ["Pistol"]), knife],
      },
      {
        profile: "Line Trooper",
        chars: stats('6"', "4", "3+", "2", "6+", "2"),
        count: 9,
        weapons: [knife],
        extra: {
          0: [flamer],
          1: [rifle],
          2: [rifle],
          3: [rifle],
          4: [rifle],
          5: [rifle],
          6: [rifle],
          7: [rifle],
          8: [rifle],
        },
      },
    ],
  );

  const heavy = unit(
    "Lance Team",
    ["Infantry", "Vanguard Legion"],
    120,
    [
      {
        name: "Braced Firing",
        text: "Each time a model in this unit makes a ranged attack, if this unit Remained Stationary this turn, re-roll a Hit roll of 1.",
      },
    ],
    [
      {
        profile: "Lance Gunner",
        chars: stats('5"', "4", "3+", "3", "6+", "1"),
        count: 5,
        weapons: [knife],
        extra: { 0: [lance], 1: [lance], 2: [lance], 3: [meltagun], 4: [rifle] },
      },
    ],
  );

  const captain = unit(
    "Field Marshal",
    ["Infantry", "Character", "Vanguard Legion"],
    75,
    [
      { name: "Invulnerable Save", text: "4+" },
      { name: "Rally Call", text: "Once per battle, a friendly unit nearby may ignore a Battle-shock test." },
      {
        name: "Steady Orders",
        text: "While this model is leading a unit, each time a model in that unit makes a ranged attack, re-roll a Wound roll of 1.",
      },
      {
        name: "Quartermaster",
        text: "At the start of your Command phase, if this model is on the battlefield, you gain 1CP.",
      },
    ],
    [
      {
        profile: "Field Marshal",
        chars: stats('6"', "4", "3+", "5", "5+", "1", "4+"),
        count: 1,
        weapons: [
          ranged("Relic Repeater", '18"', "3", "2+", "5", "-1", "2", ["Sustained Hits 1"]),
          melee("Duty Blade", "5", "2+", "5", "-2", "2", ["Lethal Hits"]),
        ],
      },
    ],
  );

  const walker = unit(
    "Bastion Walker",
    ["Vehicle", "Walker", "Vanguard Legion"],
    150,
    [{ name: "Steady Gait", text: "This model can shoot even if it Fell Back this turn." }],
    [
      {
        profile: "Bastion Walker",
        chars: stats('8"', "9", "2+", "10", "7+", "4"),
        count: 1,
        weapons: [
          ranged("Twin Autobolter", '36"', "4", "3+", "6", "-1", "2", ["Twin-linked"]),
          melee("Hydraulic Claw", "4", "3+", "12", "-2", "3"),
        ],
      },
    ],
  );

  const tank = unit(
    "Rampart Battle Tank",
    ["Vehicle", "Vanguard Legion"],
    190,
    [
      {
        name: "Armoured Hull",
        text: "Each time an attack targets this model, subtract 1 from the Damage characteristic of that attack.",
      },
    ],
    [
      {
        profile: "Rampart Battle Tank",
        chars: stats('10"', "11", "2+", "13", "7+", "3"),
        count: 1,
        weapons: [
          ranged("Siege Cannon", '48"', "D6+3", "4+", "10", "-1", "3", ["Blast", "Heavy"]),
          ranged("Hull Repeater", '36"', "3", "4+", "5", "0", "1"),
          melee("Armoured Tracks", "3", "4+", "6", "0", "1"),
        ],
      },
    ],
  );

  const units = [troopers, heavy, captain, walker, tank];
  return { name: "Vanguard Legion", points: sum(units), units, warnings: [] };
}

function ashenHost(): ImportedRoster {
  const claws = melee("Ash Claws", "3", "4+", "4", "-1", "1", ["Sustained Hits 1"]);
  const spitter = ranged("Cinder Spitter", '18"', "2", "4+", "4", "0", "1", ["Rapid Fire 1"]);
  const drill = ranged("Bone Drill", '24"', "3", "4+", "7", "-2", "2", ["Anti-Infantry 4+", "Heavy"]);

  const swarm = unit(
    "Ashen Thralls",
    ["Infantry", "Battleline", "Ashen Host"],
    80,
    [{ name: "Endless Tide", text: "Each Command phase, return one destroyed model to this unit." }],
    [
      {
        profile: "Thrall Overseer",
        chars: stats('6"', "4", "5+", "2", "7+", "2"),
        count: 1,
        weapons: [claws, melee("Overseer Hook", "3", "3+", "5", "-1", "1", ["Lethal Hits"])],
      },
      {
        profile: "Ashen Thrall",
        chars: stats('6"', "4", "5+", "1", "7+", "2"),
        count: 9,
        weapons: [spitter, claws],
      },
    ],
  );

  const elites = unit(
    "Cinder Brutes",
    ["Infantry", "Ashen Host"],
    130,
    [
      {
        name: "Feel No Pain 5+",
        text: "Each time this model would lose a wound, roll one D6: on a 5+ it does not.",
      },
    ],
    [
      {
        profile: "Cinder Brute",
        chars: stats('6"', "5", "4+", "3", "7+", "1"),
        count: 5,
        weapons: [claws],
        extra: { 0: [drill], 1: [drill], 2: [spitter], 3: [spitter], 4: [spitter] },
      },
    ],
  );

  const leader = unit(
    "Pyre Speaker",
    ["Infantry", "Character", "Psyker", "Ashen Host"],
    70,
    [
      {
        name: "Smouldering Ward",
        text: 'While a friendly Ashen Host unit is within 6" of this model, each time a ranged attack targets that unit, subtract 1 from the Hit roll.',
      },
      {
        name: "Kindle the Pyre",
        text: "Once per battle, at the start of any phase, this model can use this ability. If it does, until the end of the phase, each time a model in this unit makes a melee attack, add 1 to the Wound roll.",
      },
    ],
    [
      {
        profile: "Pyre Speaker",
        chars: stats('6"', "4", "5+", "4", "6+", "1"),
        count: 1,
        weapons: [
          ranged("Pyre Wave", '12"', "D6", "N/A", "6", "-1", "1", ["Torrent", "Psychic"]),
          melee("Ember Staff", "3", "3+", "6", "-1", "D3"),
        ],
      },
    ],
  );

  const beast = unit(
    "Cinder Colossus",
    ["Monster", "Ashen Host"],
    210,
    [
      {
        name: "Burning Bulk",
        text: "After this model ends a Charge move, roll a D6 for each enemy unit nearby.",
      },
      {
        name: "Searing Grip",
        text: "Each time this model makes an attack, re-roll a Damage roll of 1.",
      },
    ],
    [
      {
        profile: "Cinder Colossus",
        chars: stats('8"', "10", "3+", "14", "7+", "5"),
        count: 1,
        weapons: [
          ranged("Magma Gout", '18"', "D6", "3+", "8", "-2", "D6+1", ["Blast", "Devastating Wounds"]),
          melee("Crushing Talons", "6", "3+", "9", "-2", "3", ["Lethal Hits"]),
        ],
      },
    ],
  );

  const tank = unit(
    "Slag Crawler",
    ["Vehicle", "Ashen Host"],
    160,
    [
      { name: "Molten Plating", text: "Attacks with AP -1 against this model are treated as AP 0." },
      {
        name: "Fused Plates",
        text: "Each time a ranged attack targets this model, add 1 to the saving throw.",
      },
    ],
    [
      {
        profile: "Slag Crawler",
        chars: stats('10"', "10", "3+", "12", "7+", "3"),
        count: 1,
        weapons: [
          ranged("Slag Mortar", '48"', "D6", "4+", "8", "-1", "2", ["Blast", "Indirect Fire"]),
          ranged("Twin Fusion Jet", '12"', "1", "4+", "9", "-4", "D6", ["Melta 2", "Twin-linked"]),
          melee("Grinding Treads", "3", "4+", "6", "0", "1"),
        ],
      },
    ],
  );

  const units = [swarm, elites, leader, beast, tank];
  return { name: "Ashen Host", points: sum(units), units, warnings: [] };
}

function sum(units: ImportedUnit[]): number {
  return units.reduce((t, u) => t + (u.sheet.points ?? 0), 0);
}

/** A ready-made invented army: 0 = Vanguard Legion, 1 = Ashen Host. */
export function sampleRoster(variant: 0 | 1): ImportedRoster {
  return variant === 0 ? vanguardLegion() : ashenHost();
}
