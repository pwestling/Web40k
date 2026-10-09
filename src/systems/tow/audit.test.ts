import { describe, expect, it } from "vitest";
import type { GameState, WeaponProfile } from "../../core";
import { gameView } from "../../core/script";
import { abilityReminders } from "../../core/content/player";
import { towActions, weaponStrength, weaponAp } from "./combat";
import { oldWorld } from "./system";
import { towReminders } from "./reminders";
import { towRanks } from "./troops";
import { block, setup, standing, toPhase, unitNamed, type Table } from "./testing";

/**
 * Rules audit (#55): tests for the automated rules the coverage matrix
 * (docs/rules-coverage/tow.md) lists without another test, and for each fix.
 */

const view = (s: GameState) => gameView(s, "tow-hand");
const START = "hook:tow-hand:phaseStart:strategy";

function edit(t: Table, unitId: string, f: (u: GameState["units"][string]) => GameState["units"][string]) {
  t.s = { ...t.s, units: { ...t.s.units, [unitId]: f(t.s.units[unitId]!) } };
  t.states.set(t.s.seq, t.s);
}
const rule = (t: Table, unitId: string, name: string) =>
  edit(t, unitId, (u) => ({
    ...u,
    sheet: { ...u.sheet!, abilities: [...u.sheet!.abilities, { name, text: "" }] },
  }));
const status = (t: Table, unitId: string, key: string, value: unknown) =>
  edit(t, unitId, (u) => ({ ...u, status: { ...u.status, [key]: value } as never }));
/** Set a characteristic on every model of a unit. */
function char(t: Table, unitId: string, key: string, value: string) {
  const models = { ...t.s.models };
  for (const id of t.s.units[unitId]!.modelIds) {
    const m = models[id]!;
    models[id] = { ...m, profile: { ...m.profile!, chars: { ...m.profile!.chars, [key]: value } } };
  }
  t.s = { ...t.s, models };
  t.states.set(t.s.seq, t.s);
}
const melee = (t: Table, unitId: string, w: Omit<WeaponProfile, "kind">) =>
  edit(t, unitId, (u) => ({
    ...u,
    sheet: { ...u.sheet!, weapons: { ...u.sheet!.weapons, [w.id]: { ...w, kind: "melee" } } },
  }));

const rolls = (t: Table, label: RegExp) =>
  t.events.flatMap((e) =>
    e.type === "script/step"
      ? e.events.flatMap((x) => (x.type === "dice/roll" && label.test(x.roll.label ?? "") ? [x.roll] : []))
      : [],
  );

/** Play a script to the end, taking the first option of every question. */
function finish(t: Table, seed: number) {
  for (let i = 0; i < 20 && t.s.script?.waiting; i++) {
    const q = t.s.script.waiting;
    t.play({ type: "script/answer", answer: q.options[0]!.id }, q.player, seed + i);
  }
}

function fight(t: Table, unit: string, target: string, seed: number) {
  t.play({ type: "script/start", force: true, procedure: "combat", args: { unit, target } }, "p1", seed);
  finish(t, seed);
}

describe("Old World rules audit (#55)", () => {
  it("turn sequence: Strategy, Movement, Shooting, Combat in each player turn", () => {
    const seg = oldWorld.turn.round[0]!;
    expect(seg.kind).toBe("playerTurns");
    const ids = seg.kind === "playerTurns" ? seg.segments.map((s) => ("id" in s ? s.id : s.kind)) : [];
    expect(ids).toEqual(["strategy", "movement", "shooting", "combat"]);
  });

  it("combat result: wounds, ranks, standard, battle standard and a rear attack", () => {
    const { t, spears, warband } = setup();
    // The warband turned about: the spears strike its rear.
    block(t, warband, 4.8, 6, 0);
    toPhase(t, "combat");
    fight(t, spears, warband, 3);
    const result = t.notes().find((n) => n.startsWith("Combat result:"))!;
    const ours = /Marchwarden Spears \d+ \(([^)]*)\)/.exec(result)![1]!;
    expect(ours).toMatch(/ranks \+\d/);
    expect(ours).toMatch(/standard \+1/);
    expect(ours).toMatch(/battle standard \+1/);
    expect(ours).toMatch(/rear \+2/);
  });

  it("a double 1 always passes a Leadership test, whatever the Leadership", () => {
    const { t, spears } = setup();
    char(t, spears, "Ld", "0");
    // No General nearby to lend Leadership, no Battle Standard re-roll.
    edit(t, spears, (u) => ({
      ...u,
      sheet: { ...u.sheet!, abilities: [] },
    }));
    for (const id of t.s.units[spears]!.modelIds) {
      const m = t.s.models[id]!;
      if (/battle standard/i.test(m.profile?.name ?? ""))
        t.s = {
          ...t.s,
          models: { ...t.s.models, [id]: { ...m, profile: { ...m.profile!, name: "Bearer" } } },
        };
    }
    toPhase(t, "movement");
    let doubles = 0;
    for (let seed = 1; seed < 160; seed++) {
      t.play(
        { type: "script/start", force: true, procedure: "marchTest", args: { unit: spears } },
        "p1",
        seed,
      );
      const r = rolls(t, /^march test/).at(-1)!;
      const double1 = r.results.every((x) => x === 1);
      if (double1) doubles++;
      expect(t.s.units[spears]!.status?.marchTest).toBe(double1 ? 1 : 0);
    }
    expect(doubles).toBeGreaterThan(0);
  });

  it("ward and regeneration saves are rolled after armour", () => {
    let seen = 0;
    for (let seed = 1; seed < 20 && !seen; seed++) {
      const { t, spears: s, warband: w } = setup();
      char(t, w, "ward", "5");
      char(t, w, "regen", "6");
      toPhase(t, "combat");
      fight(t, s, w, seed);
      const ward = rolls(t, /^ward save$/).find((r) => r.unitId === w);
      if (!ward) continue;
      seen++;
      expect(ward.need).toBe(5);
      const regen = rolls(t, /^regeneration save$/).find((r) => r.unitId === w);
      const unsavedByWard = ward.results.filter((x) => x === 1 || x < 5).length;
      if (unsavedByWard) expect(regen?.need).toBe(6);
    }
    expect(seen).toBe(1);
  });

  it("fix: an armour save of 1+ is rolled (needing 2+), not skipped", () => {
    let seen = 0;
    for (let seed = 1; seed < 20 && !seen; seed++) {
      const { t, spears, warband } = setup();
      char(t, warband, "armour", "1");
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const save = rolls(t, /^armour save$/).find((r) => r.unitId === warband);
      if (!save) continue;
      seen++;
      expect(save.need).toBe(2);
    }
    expect(seen).toBe(1);
  });

  it("fix: close combat uses the weapon's Strength and AP", () => {
    expect(weaponStrength(3, "S")).toBe(3);
    expect(weaponStrength(3, "S+2")).toBe(5);
    expect(weaponStrength(3, "+1")).toBe(4);
    expect(weaponStrength(3, "5")).toBe(5);
    expect(weaponStrength(3, "-")).toBe(3);
    const w = (AP: string) => ({ id: "x", name: "x", kind: "melee" as const, chars: { AP }, keywords: [] });
    expect(weaponAp(w("-2"))).toBe(2);
    expect(weaponAp(w("-"))).toBe(0);

    let seen = 0;
    for (let seed = 1; seed < 20 && !seen; seed++) {
      const { t, spears, warband } = setup();
      melee(t, warband, { id: "gw", name: "Great weapon", chars: { S: "S+2", AP: "-2" }, keywords: [] });
      char(t, spears, "armour", "5");
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const notes = t.notes();
      if (!notes.some((n) => /Reaver Warband fights with Great weapon \(S5, AP -2\)/.test(n))) continue;
      seen++;
      // S5 against T3 wounds on 2+; armour 5+ worsened by 2 is 7+: no save.
      const wound = rolls(t, /^to wound$/).filter((r) => r.need === 2);
      expect(wound.length).toBeGreaterThan(0);
      expect(rolls(t, /^armour save$/).filter((r) => r.unitId === spears)).toEqual([]);
    }
    expect(seen).toBe(1);
  });

  it("Armour Bane (X) in close combat: wounds from a natural 6 save on a worse armour roll", () => {
    let seen = 0;
    for (let seed = 1; seed < 40 && !seen; seed++) {
      const { t, spears, warband } = setup();
      melee(t, warband, {
        id: "bane",
        name: "Bane blade",
        chars: { S: "S", AP: "-" },
        keywords: ["Armour Bane (2)"],
      });
      char(t, spears, "armour", "4");
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const wounds = rolls(t, /^to wound$/).filter((r) => r.unitId === warband);
      const sixes = wounds.reduce((n, r) => n + r.results.filter((x) => x === 6).length, 0);
      const bane = rolls(t, /^armour save \(Armour Bane\)$/).filter((r) => r.unitId === spears);
      if (!sixes) continue;
      seen++;
      expect(bane.map((r) => r.need)).toEqual([6]);
      expect(bane[0]!.results).toHaveLength(sixes);
    }
    expect(seen).toBe(1);
  });

  it("fix: a charging-only weapon counts only on the turn its unit charged, and the player picks between weapons", () => {
    let asked = false;
    for (let seed = 1; seed < 20 && !asked; seed++) {
      const { t: u, spears: s, warband: w } = setup();
      melee(u, w, { id: "hw", name: "Hand weapon", chars: { S: "S", AP: "-" }, keywords: [] });
      melee(u, w, { id: "gw", name: "Great weapon", chars: { S: "S+2", AP: "-2" }, keywords: [] });
      toPhase(u, "combat");
      u.play({ type: "script/start", procedure: "combat", args: { unit: s, target: w } }, "p1", seed);
      for (let i = 0; i < 20 && u.s.script?.waiting; i++) {
        const q = u.s.script.waiting;
        if (/Which weapon do(es)? (the )?Reaver Warband fight with/.test(q.question)) {
          asked = true;
          expect(q.player).toBe("p2");
          expect(q.options.map((o) => o.label)).toEqual(["Hand weapon (S3)", "Great weapon (S5, AP -2)"]);
        }
        u.play({ type: "script/answer", answer: q.options[0]!.id }, q.player, seed + i);
      }
    }
    expect(asked).toBe(true);
    // A lance: its bonus only when charging.
    let seen = 0;
    for (let seed = 1; seed < 20 && !seen; seed++) {
      const { t: u, spears: s, warband: w } = setup();
      melee(u, w, { id: "l", name: "Lance", chars: { S: "S+2", AP: "-2" }, keywords: ["Charging only"] });
      toPhase(u, "combat");
      fight(u, s, w, seed);
      if (!rolls(u, /^to wound$/).some((r) => r.unitId === w)) continue;
      seen++;
      expect(u.notes().some((n) => /fights with Lance/.test(n))).toBe(false);
    }
    expect(seen).toBe(1);
  });

  it("PX: the weapon is asked once a battle, and changed from the unit's card", () => {
    const { t: u, spears: s, warband: w } = setup();
    melee(u, w, { id: "hw", name: "Hand weapon", chars: { S: "S", AP: "-" }, keywords: [] });
    melee(u, w, { id: "gw", name: "Great weapon", chars: { S: "S+2", AP: "-2" }, keywords: [] });
    toPhase(u, "combat");
    const change = towActions.find((a) => a.id === "changeWeapon")!;
    const actor = { player: "p2", unitId: w };
    expect(change.applies!(gameView(u.s, "tow-hand"), actor)).toBe(false);
    const asks = () => {
      let n = 0;
      for (let i = 0; i < 30 && u.s.script?.waiting; i++) {
        const q = u.s.script.waiting;
        if (/^Which weapon/.test(q.question)) n++;
        const great = q.options.find((o) => o.label.startsWith("Great weapon"));
        u.play({ type: "script/answer", answer: (great ?? q.options[0]!).id }, q.player, i + 1);
      }
      return n;
    };
    u.play({ type: "script/start", procedure: "combat", args: { unit: s, target: w } }, "p1", 3);
    expect(asks()).toBe(1);
    expect(change.label!(gameView(u.s, "tow-hand"), actor)).toBe("Fights with Great weapon: change");
    // The card's change: the next fight uses the new pick without asking.
    u.play({ type: "script/start", procedure: "changeWeapon", args: { unit: w } }, "p2");
    const q = u.s.script!.waiting!;
    expect(q.question).toBe("Which weapon do the Reaver Warband fight with?");
    u.play({ type: "script/answer", answer: "Hand weapon" }, "p2");
    expect(change.label!(gameView(u.s, "tow-hand"), actor)).toBe("Fights with Hand weapon: change");
  });

  it("fix: a unit that is already fleeing can only flee again when charged", () => {
    const { t, spears, warband } = setup();
    status(t, warband, "fleeing", true);
    toPhase(t, "movement");
    t.play(
      {
        type: "script/start",
        force: true,
        procedure: "chargeReaction",
        args: { unit: spears, target: warband },
      },
      "p1",
    );
    expect(t.s.script).toBeNull();
    expect(rolls(t, /^flee roll$/).length).toBe(1);
    expect(t.notes().join(" ")).toMatch(/Reaver Warband is already fleeing and flees/);
  });

  it("fix: a unit in combat can't stand and shoot", () => {
    const { t, warband } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    const brutes = unitNamed(t.s, "Tusk Brutes").id;
    // The bows are already fighting the brutes when the warband charges them.
    block(t, bows, -20, 5, 0);
    block(t, brutes, -19.2, 3, Math.PI);
    block(t, warband, -30, 6, 0);
    toPhase(t, "movement");
    t.play(
      {
        type: "script/start",
        force: true,
        procedure: "chargeReaction",
        args: { unit: warband, target: bows },
      },
      "p2",
    );
    const q = t.s.script?.waiting;
    expect(q?.options.map((o) => o.id)).toEqual(["hold", "flee"]);
  });

  it("fix: a charge needs the target in sight (its vision arc)", () => {
    const { t, spears, warband } = setup();
    const declare = towActions.find((a) => a.id === "chargeReaction")!;
    // The warband 6" behind the spears' rear rank: out of their front arc.
    block(t, warband, -10, 6, 0);
    for (const u of Object.values(t.s.units))
      if (u.id !== spears && u.id !== warband)
        block(t, u.id, 40 + Object.keys(t.s.units).indexOf(u.id) * 3, 3, 0);
    toPhase(t, "movement");
    const actor = { player: "p1", unitId: spears };
    expect(declare.available(view(t.s), actor)).toBe("No enemy it can see to charge");
    block(t, warband, 6, 6, Math.PI);
    expect(declare.available(view(t.s), actor)).toBe(true);
    expect(declare.targets!(view(t.s), actor).map((x) => x.unitId)).toEqual([warband]);
  });

  it("fix: fleeing, marching or fighting units can't shoot", () => {
    const shootAt = (prep: (t: Table, bows: string) => void) => {
      const { t } = setup();
      const bows = unitNamed(t.s, "Fen Bowmen").id;
      const slingers = unitNamed(t.s, "Reaver Slingers").id;
      block(t, bows, -20, 5, 0);
      block(t, slingers, -12, 5, Math.PI);
      block(t, unitNamed(t.s, "Wolf Runners").id, 20, 5, Math.PI);
      toPhase(t, "shooting");
      prep(t, bows);
      return () =>
        t.play(
          { type: "action/take", unitId: bows, action: "shoot", weapon: "missile", targetId: slingers },
          "p1",
        );
    };
    expect(shootAt(() => {})).not.toThrow();
    expect(shootAt((t, b) => status(t, b, "fleeing", true))).toThrow(/Rejected/);
    expect(shootAt((t, b) => status(t, b, "marching", true))).toThrow(/Rejected/);
    // Quick Shot lets a unit shoot after marching.
    expect(
      shootAt((t, b) => {
        status(t, b, "marching", true);
        rule(t, b, "Quick Shot");
      }),
    ).not.toThrow();
    expect(shootAt((t) => block(t, unitNamed(t.s, "Tusk Brutes").id, -19.2, 3, Math.PI))).toThrow(/Rejected/);
  });

  it("new: fleeing units take a Rally test at the start of their turn", () => {
    const seen = { rallied: 0, fled: 0 };
    for (let seed = 1; seed < 40 && !(seen.rallied && seen.fled); seed++) {
      const { t, spears } = setup();
      status(t, spears, "fleeing", true);
      t.play({ type: "script/start", procedure: START, args: { player: "p1" } }, "p1", seed);
      const r = rolls(t, /^Rally test/);
      expect(r.length).toBeGreaterThan(0);
      if (t.s.units[spears]!.status?.fleeing) {
        seen.fled++;
        expect(t.notes().join(" ")).toMatch(/keeps fleeing/);
      } else {
        seen.rallied++;
        expect(t.notes().join(" ")).toMatch(/rallies/);
      }
    }
    expect(seen.rallied && seen.fled).toBeTruthy();
    // The other side's fleeing units wait for their own turn.
    const { t, warband } = setup();
    status(t, warband, "fleeing", true);
    t.play({ type: "script/start", procedure: START, args: { player: "p1" } }, "p1");
    expect(rolls(t, /^Rally test/).length).toBe(0);
  });

  it("Command sub-phase: after the start of turn and before rallying, the General is named and command abilities come up", () => {
    const { t, spears } = setup();
    status(t, spears, "fleeing", true);
    const general = Object.values(t.s.units).find((u) => u.owner === "p1" && u.id !== spears)!.id;
    status(t, general, "general", true);
    t.play({ type: "script/start", procedure: START, args: { player: "p1" } }, "p1", 3);
    const notes = t.notes();
    const command = notes.findIndex((n) => /^Command sub-phase: .*may use command abilities/.test(n));
    const rally = notes.findIndex((n) => /rallies|keeps fleeing/.test(n));
    expect(command).toBeGreaterThanOrEqual(0);
    expect(notes[command]).toContain(t.s.units[general]!.name);
    expect(command).toBeLessThan(rally);
    // An imported ability that says it is used in the Command sub-phase comes up in its side's Strategy phase.
    edit(t, spears, (u) => ({
      ...u,
      sheet: {
        ...u.sheet!,
        abilities: [...u.sheet!.abilities, { name: "Rousing call", text: "Used in the Command sub-phase." }],
      },
    }));
    status(t, spears, "fleeing", false);
    toPhase(t, "strategy");
    expect(abilityReminders(t.s).map((r) => [r.unitId, r.ability.name])).toContainEqual([
      spears,
      "Rousing call",
    ]);
  });

  it("new: reminders for compulsory flee moves, Frenzy's charge and Look Out, Sir!", () => {
    const { t, spears, warband } = setup();
    toPhase(t, "movement");
    status(t, spears, "fleeing", true);
    const riders = unitNamed(t.s, "Riders of the Downs").id;
    rule(t, riders, "Frenzy");
    block(t, riders, -8, 5, 0);
    block(t, warband, 0.8, 6, Math.PI);
    const ids = (w: ReturnType<typeof towReminders>) => w.map((x) => `${x.id}:${x.unitId}`);
    const now = ids(towReminders(view(t.s)));
    expect(now).toContain(`towCompulsoryFlee:${spears}`);
    expect(now).toContain(`towFrenzyCharge:${riders}`);
    // Look Out, Sir! in the shooting phase, for an enemy unit a character has joined.
    toPhase(t, "shooting");
    edit(t, warband, (u) => ({ ...u, joined: [{ ...u, id: "chief" }] }));
    expect(ids(towReminders(view(t.s)))).toContain(`towLookOutSir:${warband}`);
  });

  it("new: a winner that wipes out its foe is reminded it may overrun", () => {
    let seen = 0;
    for (let seed = 1; seed < 40 && !seen; seed++) {
      const { t, spears, warband } = setup();
      // Leave the warband one model in the front rank.
      const keep = t.s.units[warband]!.modelIds[5]!;
      const models = { ...t.s.models };
      for (const id of t.s.units[warband]!.modelIds)
        if (id !== keep) models[id] = { ...models[id]!, destroyed: true };
      t.s = { ...t.s, models };
      t.states.set(t.s.seq, t.s);
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      // Wiped out in the fight itself, not run down in a pursuit.
      if (standing(t.s, warband) || t.notes().some((n) => /pursues/.test(n))) continue;
      seen++;
      expect(t.notes().join(" | ")).toMatch(/Marchwarden Spears destroyed Reaver Warband: it may overrun/);
    }
    expect(seen).toBe(1);
  });
  it("fix: stand and shoot uses graded cover (partial -1, full -2)", () => {
    const label = (x: number | null, width: number) => {
      const { t, warband } = setup();
      const bows = unitNamed(t.s, "Fen Bowmen").id;
      block(t, bows, -10, 5, 0);
      block(t, warband, 4, 6, Math.PI);
      if (x !== null) {
        t.s = {
          ...t.s,
          terrain: [
            {
              id: "w",
              name: "Woods",
              category: "woods",
              position: { x, y: 6 },
              width,
              depth: 10,
              facing: 0,
              solids: [],
            },
          ],
        };
        t.states.set(t.s.seq, t.s);
      }
      toPhase(t, "movement");
      t.play(
        { type: "script/start", procedure: "chargeReaction", args: { unit: warband, target: bows } },
        "p2",
      );
      t.play({ type: "script/answer", answer: "shoot" }, "p1", 2);
      return rolls(t, /^to hit/)[0]!.label!;
    };
    expect(label(null, 0)).toBe("to hit (stand and shoot)");
    expect(label(-2, 1)).toBe("to hit (stand and shoot, partial cover)");
    expect(label(0, 8)).toBe("to hit (6 then 4+) (stand and shoot, full cover)");
  });

  it("fleeing units can't declare a charge", () => {
    const { t, spears } = setup();
    status(t, spears, "fleeing", true);
    toPhase(t, "movement");
    const declare = towActions.find((a) => a.id === "chargeReaction")!;
    expect(declare.available(view(t.s), { player: "p1", unitId: spears })).toBe("Fleeing units can't charge");
  });

  it("Frenzy: a frenzied winner must pursue, and a frenzied loser loses its Frenzy", () => {
    const seen = { won: 0, lost: 0 };
    for (let seed = 1; seed < 40 && !(seen.won && seen.lost); seed++) {
      const { t, spears, warband } = setup();
      rule(t, spears, "Frenzy");
      rule(t, warband, "Frenzy");
      toPhase(t, "combat");
      t.play(
        { type: "script/start", procedure: "combat", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      const notes = t.notes().join(" | ");
      // No restraint question for a frenzied winner.
      expect(t.s.script?.waiting?.options.some((o) => o.id === "restrain") ?? false).toBe(false);
      finish(t, seed);
      for (const [id, name] of [
        [spears, "Marchwarden Spears"],
        [warband, "Reaver Warband"],
      ] as const) {
        if (new RegExp(`${name} lost the combat and its Frenzy`).test(notes)) {
          seen.lost++;
          expect(t.s.units[id]!.status?.frenzyLost).toBe(true);
        }
        if (new RegExp(`${name} must (pursue|follow up) \\(Frenzy\\)`).test(notes)) seen.won++;
      }
    }
    expect(seen.won && seen.lost).toBeTruthy();
  });

  it("Massed Infantry: +1 combat result for the side with more Unit Strength", () => {
    const { t, spears, warband } = setup();
    rule(t, spears, "Massed Infantry");
    rule(t, warband, "Massed Infantry");
    toPhase(t, "combat");
    fight(t, spears, warband, 3);
    const result = t.notes().find((n) => n.startsWith("Combat result:"))!;
    const side = (name: string) => new RegExp(`${name} \\d+ \\(([^)]*)\\)`).exec(result)![1]!;
    const us = (id: string) => standing(t.s, id);
    // Measured after the blows: whichever side still has more models scores it.
    if (us(spears) > us(warband)) expect(side("Marchwarden Spears")).toMatch(/massed infantry \+1/);
    if (us(warband) > us(spears)) expect(side("Reaver Warband")).toMatch(/massed infantry \+1/);
    expect(result.match(/massed infantry/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
  it("rank width and rank bonus cap by troop type", () => {
    const { t, spears } = setup();
    const as = (troop: string) => {
      char(t, spears, "Troop", troop);
      return towRanks(t.s, t.s.units[spears]!);
    };
    expect(as("Regular Infantry")).toEqual({ width: 5, maxBonus: 2 });
    expect(as("Heavy Infantry")).toEqual({ width: 4, maxBonus: 2 });
    expect(as("Heavy Cavalry")).toEqual({ width: 4, maxBonus: 1 });
    expect(as("Light Cavalry")).toEqual({ width: 5, maxBonus: 1 });
    expect(as("Swarms")).toEqual({ width: 5, maxBonus: 0 });
    expect(as("Monster")).toEqual({ width: 5, maxBonus: 0 });
  });
});
