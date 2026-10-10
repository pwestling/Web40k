import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  previewAttack,
  resolveIntent,
  rollStage,
  startAttack,
  type Ability,
  type GameState,
  type Model,
} from "../../core";
import { manualAbilities } from "../../core/content/player";
import { getSystem } from "../../core/content/systems";
import { coverage, recognize } from "./recognize";
import { sampleRoster } from "./sample";
import { seededRng } from "../../sandbox/protocol";
import { aurasFor, firstAnswers, tableAttack } from "../../companion/attack";

const next = (s: GameState) => applyEvent(s, { type: "turn/next", seed: 1 });
const system = getSystem("forty-k-11");
const read = (text: string) => recognize({ name: "Test", text }, system);

// Invented wording in the shapes imported datasheets use; no real rules text.
describe("reading ability text", () => {
  it("reads an invulnerable save given to a unit, also while leading", () => {
    expect(read("Models in this unit have a 5+ invulnerable save.")?.parts).toEqual([
      { kind: "invuln", x: 5 },
    ]);
    const led = read("While this model is leading a unit, models in that unit have a 4+ invulnerable save.");
    expect(led?.parts).toEqual([{ kind: "invuln", x: 4 }]);
    expect(led?.whileLeading).toBe(true);
  });

  it("reads re-rolls and modifiers for a unit's own attacks", () => {
    expect(read("Each time a model in this unit makes an attack, re-roll a Hit roll of 1.")?.parts).toEqual([
      { kind: "attack", side: "making", roll: "hit", reroll: "ones" },
    ]);
    expect(
      read("Each time a model in this unit makes a melee attack, you can re-roll the Wound roll.")?.parts,
    ).toEqual([{ kind: "attack", side: "making", weapon: "melee", roll: "wound", reroll: "failed" }]);
    expect(
      read(
        "Each time a model in this unit makes a ranged attack, if this unit Remained Stationary this turn, add 1 to the Hit roll and add 1 to the Wound roll.",
      )?.parts,
    ).toEqual([
      { kind: "attack", side: "making", weapon: "ranged", when: "stationary", roll: "hit", by: 1 },
      { kind: "attack", side: "making", weapon: "ranged", when: "stationary", roll: "wound", by: 1 },
    ]);
    expect(
      read(
        "Each time a model in this unit makes an attack that targets a Monster or Vehicle unit, add 1 to the Wound roll.",
      )?.parts,
    ).toEqual([{ kind: "attack", side: "making", against: ["monster", "vehicle"], roll: "wound", by: 1 }]);
  });

  it("reads attacks against the unit, Feel No Pain and weapon abilities", () => {
    expect(read("Each time a ranged attack targets this unit, subtract 1 from the Hit roll.")?.parts).toEqual(
      [{ kind: "attack", side: "targeted", weapon: "ranged", roll: "hit", by: -1 }],
    );
    expect(read("Models in this unit have the Feel No Pain 5+ ability.")?.parts).toEqual([
      { kind: "fnp", x: 5 },
    ]);
    const lethal = read(
      "Each time a model in this unit makes a melee attack, if this unit made a Charge move this turn, that attack has the [LETHAL HITS] ability.",
    );
    expect(lethal?.parts[0]).toMatchObject({ grant: "lethal hits", when: "charged" });
    expect(lethal?.effects[0]?.do).toEqual([{ do: "autoPass", step: "wound" }]);
    // Sustained Hits 2 stands alone: its parameter is written into the effect.
    const sustained = read(
      "Ranged weapons equipped by models in this unit have the [SUSTAINED HITS 2] ability.",
    );
    expect(JSON.stringify(sustained?.effects)).not.toContain("param.");
  });

  it("reads scoping: while leading, auras and once per battle", () => {
    const leading = read(
      "While this model is leading a unit, each time a model in that unit makes an attack, re-roll a Wound roll of 1.",
    );
    expect(leading?.whileLeading).toBe(true);
    const aura = read(
      'While a friendly Battle Line unit is within 6" of this model, each time a model in that unit makes an attack, add 1 to the Hit roll.',
    );
    expect(aura?.aura).toEqual({ range: 6, side: "friendly", keyword: "battle line" });
    const once = read(
      "Once per battle, at the start of any phase, this unit can use this ability. If it does, until the end of the phase, each time a model in this unit makes an attack, add 1 to the Wound roll.",
    );
    expect(once?.oncePerBattle).toBe(true);
    expect(once?.parts).toHaveLength(1);
  });

  it("reads start and end of phase triggers", () => {
    expect(
      read("At the start of your Command phase, if this model is on the battlefield, you gain 1CP.")?.trigger,
    ).toEqual({
      phase: "command",
      at: "start",
      gain: { resource: "CP", amount: 1 },
    });
    expect(
      read("At the end of your Movement phase, one model in this unit regains up to D3 lost wounds.")
        ?.trigger,
    ).toEqual({
      phase: "movement",
      at: "end",
      heal: "D3",
    });
  });

  it("reads damage re-rolls, save modifiers and Damage −1 (#40)", () => {
    expect(
      read("Each time a model in this unit makes an attack, you can re-roll the Damage roll.")?.parts,
    ).toEqual([{ kind: "attack", side: "making", roll: "damage", reroll: "failed" }]);
    expect(
      read("Each time a model in this unit makes a melee attack, re-roll a Damage roll of 1.")?.parts,
    ).toEqual([{ kind: "attack", side: "making", weapon: "melee", roll: "damage", reroll: "ones" }]);
    expect(read("Each time a ranged attack targets this unit, add 1 to the saving throw.")?.parts).toEqual([
      { kind: "attack", side: "targeted", weapon: "ranged", roll: "save", by: 1 },
    ]);
    const tough = read(
      "Each time an attack targets this unit, subtract 1 from the Damage characteristic of that attack.",
    );
    expect(tough?.parts).toEqual([{ kind: "attack", side: "targeted", roll: "damage", by: -1 }]);
    expect(tough?.effects[0]?.do).toEqual([
      { do: "modifyCharacteristic", target: "weapon", characteristic: "D", by: -1 },
    ]);
    // Only the defender's own side can make its save better or the damage less.
    expect(read("Each time a model in this unit makes an attack, add 1 to the saving throw.")).toBeNull();
    expect(read("Each time an attack targets this unit, you can re-roll the Damage roll.")).toBeNull();
  });

  it("leaves anything not read in full as a reminder", () => {
    expect(
      read("Each time a model in this unit makes an attack, re-roll a Hit roll of 1. It also glows."),
    ).toBeNull();
    expect(
      read("Each time an attack targets this unit, worsen the Armour Penetration of that attack by 1."),
    ).toBeNull();
    expect(read("Each time an attack targets this unit, re-roll the Hit roll.")).toBeNull();
    expect(read("Once per battle, this unit can do a little dance.")).toBeNull();
    expect(read("")).toBeNull();
  });

  it("counts coverage for an army", () => {
    const abilities: Ability[] = [
      { name: "Feel No Pain 5+", text: "Shrugs it off." },
      {
        name: "Volley",
        text: "Each time a model in this unit makes a ranged attack, re-roll a Hit roll of 1.",
      },
      { name: "Strange", text: "Does something odd." },
    ];
    const c = coverage([{ id: "a", abilities }], system);
    expect(c).toMatchObject({ automated: 1, total: 3 });
    expect(c.proposals.map((p) => p.ability.name)).toEqual(["Volley"]);
  });
});

const model = (id: string, owner: string, x: number, y: number): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { M: '6"', T: "4", SV: "3+", W: "3", LD: "6+", OC: "1" } },
  weapons: ["gun"],
});

function addUnit(
  s: GameState,
  id: string,
  owner: string,
  x: number,
  abilities: Ability[],
  keywords: string[] = [],
) {
  return applyEvent(s, {
    type: "unit/add",
    unit: {
      id,
      owner,
      name: id,
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: {
        keywords,
        abilities,
        weapons: {
          gun: {
            id: "gun",
            name: "Gun",
            kind: "ranged",
            chars: { RANGE: '24"', A: "2", BS: "3+", S: "4", AP: "0", D: "1" },
            keywords: [],
          },
        },
      },
    },
    models: [model(`${id}1`, owner, x, 0), model(`${id}2`, owner, x + 1.5, 0)],
  });
}

function setup(abilities: Record<string, Ability[]>): GameState {
  let s = createInitialState();
  s = applyEvent(s, { type: "game/system", system: "forty-k-11" });
  for (const [id, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    s = applyEvent(s, { type: "player/join", player: { id, name: id, color: "#fff", seat } });
  s = addUnit(s, "shooters", "p1", 0, abilities.shooters ?? [], ["Infantry", "Battle Line"]);
  s = addUnit(s, "captain", "p1", 4, abilities.captain ?? [], ["Infantry", "Character"]);
  s = addUnit(s, "targets", "p2", 12, abilities.targets ?? [], ["Infantry"]);
  return s;
}

const automate = (s: GameState, id: string, ability: Ability) => {
  const auto = recognize(ability, system)!;
  const event = resolveIntent(
    { type: "unit/automate", id, ability: ability.name, auto },
    s.units[id]!.owner,
    Math.random,
    s,
  );
  return applyEvent(s, event!);
};

describe("automated abilities at the table", () => {
  const volley: Ability = {
    name: "Volley",
    text: "Each time a model in this unit makes a ranged attack, re-roll a Hit roll of 1.",
  };
  const banner: Ability = {
    name: "Banner",
    text: 'While a friendly Battle Line unit is within 6" of this model, each time a model in that unit makes an attack, add 1 to the Hit roll.',
  };
  const shroud: Ability = {
    name: "Shroud",
    text: "Each time a ranged attack targets this unit, subtract 1 from the Hit roll.",
  };

  it("runs in the attack once confirmed, and leaves the reminders", () => {
    let s = setup({ shooters: [volley], targets: [shroud] });
    expect(previewAttack(s, "shooters", "gun", "targets")!.spec.rerollHits).toBe("none");
    expect(manualAbilities(system, s.units.shooters!)).toHaveLength(1);
    s = automate(s, "shooters", volley);
    s = automate(s, "targets", shroud);
    const p = previewAttack(s, "shooters", "gun", "targets")!;
    expect(p.spec.rerollHits).toBe("ones");
    expect(p.spec.hitMod).toBe(-1);
    expect(p.fired.hit).toEqual(expect.arrayContaining(["Volley", "Shroud"]));
    // What each did, kept on the spec for the panel and the log (UX 290).
    expect(p.spec.because).toEqual(
      expect.arrayContaining([
        { name: "Volley", step: "hit", change: { reroll: "ones" } },
        { name: "Shroud", step: "hit", change: { mod: -1 } },
      ]),
    );
    expect(manualAbilities(system, s.units.shooters!)).toHaveLength(0);
    // Only the owner can switch it.
    expect(
      resolveIntent(
        { type: "unit/automate", id: "shooters", ability: "Volley", auto: null },
        "p2",
        Math.random,
        s,
      ),
    ).toBeNull();
  });

  it("re-rolls damage, improves the save and lowers Damage, never below 1 (#40)", () => {
    const brutal: Ability = {
      name: "Brutal",
      text: "Each time a model in this unit makes an attack, re-roll a Damage roll of 1.",
    };
    const ward: Ability = {
      name: "Ward",
      text: "Each time an attack targets this unit, add 1 to the saving throw.",
    };
    const hide: Ability = {
      name: "Hide",
      text: "Each time an attack targets this unit, subtract 1 from the Damage characteristic of that attack.",
    };
    let s = setup({ shooters: [brutal], targets: [ward, hide] });
    for (const [id, a] of [
      ["shooters", brutal],
      ["targets", ward],
      ["targets", hide],
    ] as const)
      s = automate(s, id, a);
    const p = previewAttack(s, "shooters", "gun", "targets")!;
    expect(p.spec.rerollDamage).toBe("ones");
    expect(p.spec.saveMod).toBe(1);
    // D1 − 1 stays 1.
    expect(p.spec.damage).toBe("1");
    expect(p.spec.because).toEqual(
      expect.arrayContaining([
        { name: "Brutal", step: "damage", change: { reroll: "ones" } },
        { name: "Ward", step: "save", change: { mod: 1 } },
        { name: "Hide", step: "damage", change: { mod: -1 } },
      ]),
    );
    // Rolled through: with D6 damage, a 1 is rolled again (two models, so two rolls an attack; a few seeds).
    const d6 = { ...p.spec, damage: "D6", hit: 2, wound: 2, save: null, attacks: "10" };
    const rolled = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((seed) => {
      let a = startAttack(d6, seededRng(seed), s);
      for (let i = 0; i < 6 && a.stage !== "done"; i++) a = rollStage(s, a, seededRng(seed * 10 + i));
      return a.damage ?? [];
    });
    expect(rolled.some((d) => d.rerolledFrom === 1)).toBe(true);
    expect(rolled.every((d) => d.rerolledFrom === undefined || d.rerolledFrom === 1)).toBe(true);
  });

  it("gives an aura to units in range with the keyword", () => {
    let s = setup({ captain: [banner] });
    s = automate(s, "captain", banner);
    expect(previewAttack(s, "shooters", "gun", "targets")!.spec.hitMod).toBe(1);
    // The captain is no Battle Line unit; the enemy doesn't get it either.
    expect(previewAttack(s, "captain", "gun", "targets")!.spec.hitMod).toBe(0);
    expect(previewAttack(s, "targets", "gun", "shooters")!.spec.hitMod).toBe(0);
    const far = applyEvent(s, {
      type: "models/move",
      moves: [
        { id: "captain1", to: { x: 40, y: 20 } },
        { id: "captain2", to: { x: 42, y: 20 } },
      ],
    });
    expect(previewAttack(far, "shooters", "gun", "targets")!.spec.hitMod).toBe(0);
  });

  it("works in Table companion mode, with the players saying which auras reach", () => {
    let s = setup({ shooters: [volley], captain: [banner] });
    s = automate(automate(s, "shooters", volley), "captain", banner);
    const answers = firstAnswers(s, "shooters", "gun");
    expect(tableAttack(s, "shooters", "gun", "targets", answers)!.spec.rerollHits).toBe("ones");
    expect(tableAttack(s, "shooters", "gun", "targets", answers)!.spec.hitMod).toBe(0);
    const q = aurasFor(s, "shooters", "targets");
    expect(q.map((x) => x.ability.name)).toEqual(["Banner"]);
    const near = { ...answers, auras: [q[0]!.key] };
    expect(tableAttack(s, "shooters", "gun", "targets", near)!.spec.hitMod).toBe(1);
  });

  it("runs once per battle from when it's used until the end of the phase", () => {
    const fury: Ability = {
      name: "Fury",
      text: "Once per battle, at the start of any phase, this unit can use this ability. If it does, until the end of the phase, each time a model in this unit makes an attack, add 1 to the Hit roll.",
    };
    let s = setup({ shooters: [fury] });
    s = automate(s, "shooters", fury);
    expect(previewAttack(s, "shooters", "gun", "targets")!.spec.hitMod).toBe(0);
    s = applyEvent(s, { type: "unit/status", id: "shooters", key: "auto.Fury", value: true });
    expect(previewAttack(s, "shooters", "gun", "targets")!.spec.hitMod).toBe(1);
    s = next(next(s));
    expect(s.units.shooters?.status?.["auto.Fury"]).toBeUndefined();
  });

  it("gains CP and heals at the start or end of a phase", () => {
    const orders: Ability = {
      name: "Orders",
      text: "At the start of your Command phase, if this model is on the battlefield, you gain 1CP.",
    };
    const mend: Ability = {
      name: "Mend",
      text: "At the end of your Command phase, one model in this unit regains up to 2 lost wounds.",
    };
    let s = setup({ captain: [orders, mend] });
    s = automate(automate(s, "captain", orders), "captain", mend);
    s = { ...s, models: { ...s.models, captain2: { ...s.models.captain2!, woundsLost: 2 } } };
    const cp = (st: GameState) => st.resources.p1?.CP ?? 0;
    const before = cp(s);
    s = next(s);
    // The Command phase itself gives 1CP; Orders gives one more.
    expect(cp(s) - before).toBe(2);
    expect(s.triggered?.map((t) => t.ability)).toContain("Orders");
    s = next(s);
    expect(s.models.captain2?.woundsLost).toBe(0);
    expect(s.triggered).toEqual([{ unitId: "captain", ability: "Mend", healed: { wounds: 2 } }]);
  });
});

describe("the sample armies", () => {
  it("offer abilities to automate", () => {
    const names = [0, 1].flatMap((seat) => {
      const roster = sampleRoster(seat as 0 | 1);
      return coverage(
        roster.units.map((u, i) => ({ id: String(i), abilities: u.sheet.abilities })),
        system,
      ).proposals.map((p) => p.ability.name);
    });
    expect(names).toEqual(
      expect.arrayContaining([
        "Braced Firing",
        "Steady Orders",
        "Quartermaster",
        "Smouldering Ward",
        "Kindle the Pyre",
        "Armoured Hull",
        "Searing Grip",
        "Fused Plates",
      ]),
    );
  });
});
