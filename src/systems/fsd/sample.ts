import type { BaseShape, WeaponProfile } from "../../core";
import type { ImportedRoster, ImportedUnit } from "../wh40k/roster";

/**
 * Two invented warbands for Full Spectrum Dominance style games, so players
 * can try the system without typing up unit cards. Names and numbers are made
 * up; none come from the game's own cards.
 *
 * Profiles use the characteristics the FSD system reads (see
 * core/content/examples/fsd.ts): Cmd, Def, Save "d8(2)", Move in DU and an
 * optional damage Chart; weapons have Range in DU, Attack "3d6", AP, AD slots
 * and keywords such as "Per Base" and "IC".
 */

interface WeaponSpec {
  name: string;
  range: number;
  attack: string;
  ap?: number;
  ad?: string;
  keywords?: string[];
}

function weapon(w: WeaponSpec): WeaponProfile {
  const chars: Record<string, string> = { Range: String(w.range), Attack: w.attack, AP: String(w.ap ?? 0) };
  if (w.ad) chars.AD = w.ad;
  return {
    id: w.name.toLowerCase().replace(/\W+/g, "-"),
    name: w.name,
    kind: "ranged",
    chars,
    keywords: w.keywords ?? [],
  };
}

function unit(
  name: string,
  keywords: string[],
  points: number,
  bases: number,
  base: BaseShape,
  chars: { Cmd: number; Def: number; Save: string; Move: number; Chart?: string },
  weapons: WeaponSpec[],
): ImportedUnit {
  const profiles = weapons.map(weapon);
  const stats: Record<string, string> = {
    Cmd: String(chars.Cmd),
    Def: String(chars.Def),
    Save: chars.Save,
    Move: String(chars.Move),
  };
  if (chars.Chart) stats.Chart = chars.Chart;
  return {
    name,
    base,
    sheet: { weapons: Object.fromEntries(profiles.map((w) => [w.id, w])), abilities: [], keywords, points },
    models: Array.from({ length: bases }, (_, i) => ({
      profile: { name: bases > 1 ? `${name} ${i + 1}` : name, chars: stats },
      // Every base can use the unit's weapons; the unit attacks once per action.
      weapons: profiles.map((w) => w.id),
    })),
  };
}

const TEAM: BaseShape = { shape: "round", diameterMm: 30 };
const WALKER: BaseShape = { shape: "round", diameterMm: 50 };
const HULL: BaseShape = { shape: "rect", widthMm: 50, depthMm: 80 };

const rifles: WeaponSpec = { name: "Rifles", range: 3, attack: "1d6", keywords: ["Per Base"] };

function coalition(): ImportedRoster {
  const units = [
    unit("Command Team", ["INFANTRY"], 8, 2, TEAM, { Cmd: 2, Def: 4, Save: "d6(1)", Move: 2 }, [
      rifles,
      { name: "Marker Beacon", range: 6, attack: "1d8", ad: "1-2", keywords: ["IC"] },
    ]),
    unit("Rifle Squad", ["INFANTRY"], 7, 3, TEAM, { Cmd: 0, Def: 4, Save: "d6(1)", Move: 2 }, [
      rifles,
      { name: "Grenades", range: 1, attack: "1d8", ap: 1 },
    ]),
    unit("Rifle Squad B", ["INFANTRY"], 7, 3, TEAM, { Cmd: 0, Def: 4, Save: "d6(1)", Move: 2 }, [
      rifles,
      { name: "Grenades", range: 1, attack: "1d8", ap: 1 },
    ]),
    unit(
      "Strider Walker",
      ["MECH"],
      14,
      1,
      WALKER,
      {
        Cmd: 1,
        Def: 3,
        Save: "d8(2)",
        Move: 3,
        Chart: "1:red, 2:orange:ARM, 3:white:MOV, 4:white:S1, 5-6:white:PIN",
      },
      [
        { name: "Autocannon", range: 4, attack: "2d8", ap: 1, ad: "3-6" },
        { name: "Light MG", range: 3, attack: "3d6" },
      ],
    ),
    unit(
      "Lancer Tank",
      ["VEHICLE"],
      18,
      1,
      HULL,
      {
        Cmd: 1,
        Def: 3,
        Save: "d10(2)",
        Move: 4,
        Chart: "1:red, 2-3:orange:ARM, 4:white:MOV, 5:white:S1, 6:white:PIN",
      },
      [
        { name: "Light Cannon", range: 6, attack: "1d10", ap: 1, ad: "4-6" },
        { name: "Coax MG", range: 3, attack: "3d6" },
      ],
    ),
  ];
  return { name: "Coalition Patrol", points: total(units), units, warnings: [] };
}

function syndicate(): ImportedRoster {
  const units = [
    unit("Boss Crew", ["INFANTRY"], 8, 2, TEAM, { Cmd: 2, Def: 4, Save: "d6(1)", Move: 2 }, [
      { name: "Scatterguns", range: 2, attack: "2d6", keywords: ["Per Base"] },
    ]),
    unit("Raider Gang", ["INFANTRY"], 6, 3, TEAM, { Cmd: 0, Def: 4, Save: "d6(1)", Move: 3 }, [
      { name: "Carbines", range: 3, attack: "1d6", keywords: ["Per Base"] },
      { name: "Breaching Charges", range: 1, attack: "1d10", ap: 2, ad: "1-3" },
    ]),
    unit("Raider Gang B", ["INFANTRY"], 6, 3, TEAM, { Cmd: 0, Def: 4, Save: "d6(1)", Move: 3 }, [
      { name: "Carbines", range: 3, attack: "1d6", keywords: ["Per Base"] },
      { name: "Breaching Charges", range: 1, attack: "1d10", ap: 2, ad: "1-3" },
    ]),
    unit(
      "Scrap Crawler",
      ["VEHICLE"],
      15,
      1,
      HULL,
      {
        Cmd: 1,
        Def: 3,
        Save: "d8(3)",
        Move: 3,
        Chart: "1:red, 2:orange:MOV, 3:orange:ARM, 4:white:S1, 5-6:white:PIN",
      },
      [
        { name: "Rocket Rack", range: 5, attack: "2d8", ap: 1, ad: "1-2 1-2" },
        { name: "Heavy Stubber", range: 3, attack: "3d8" },
      ],
    ),
    unit(
      "Junk Walker",
      ["MECH"],
      12,
      1,
      WALKER,
      {
        Cmd: 0,
        Def: 3,
        Save: "d8(2)",
        Move: 3,
        Chart: "1:red, 2:orange:ARM, 3:white:MOV, 4:white:S1, 5-6:white:PIN",
      },
      [{ name: "Power Claw", range: 1, attack: "2d10", ap: 2 }],
    ),
  ];
  return { name: "Syndicate Warband", points: total(units), units, warnings: [] };
}

function total(units: ImportedUnit[]): number {
  return units.reduce((t, u) => t + (u.sheet.points ?? 0), 0);
}

/** A ready-made invented warband: 0 = Coalition Patrol, 1 = Syndicate Warband. */
export function fsdSample(variant: 0 | 1): ImportedRoster {
  return variant === 0 ? coalition() : syndicate();
}
