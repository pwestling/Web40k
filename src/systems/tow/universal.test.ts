import { describe, expect, it } from "vitest";
import { currentSlot, type GameState, type Unit } from "../../core";
import { previewRun } from "../../core/content";
import { procedureEnv, procedureRoles } from "../../core/content/play";
import { isAutomated } from "../../core/content/player";
import { getSystem } from "../../core/content/systems";
import { gameView } from "../../core/script";
import { joinBar } from "./characters";
import { magicActions } from "./magic";
import { formationWarning, towReminders } from "./reminders";
import { hatesFoe } from "./specialRules";
import { oldWorld } from "./system";
import { towRanks } from "./troops";
import { block, setup, toPhase, unitNamed, type Table } from "./testing";

/**
 * The core rulebook's universal special rules, by name (#66). Invented units
 * and numbers; the rules come in by name only, as an imported list has them.
 */

const view = (s: GameState) => gameView(s, "tow-hand");

/** Give a unit special rules by name, as a roster would. */
function rule(t: Table, unitId: string, ...names: string[]) {
  const u = t.s.units[unitId]!;
  const abilities = [...u.sheet!.abilities, ...names.map((name) => ({ name, text: "" }))];
  t.s = { ...t.s, units: { ...t.s.units, [unitId]: { ...u, sheet: { ...u.sheet!, abilities } } } };
  t.states.set(t.s.seq, t.s);
}

/** Change every model's characteristics in a unit. */
function chars(t: Table, unitId: string, set: Record<string, string>) {
  const models = { ...t.s.models };
  for (const id of t.s.units[unitId]!.modelIds) {
    const m = models[id]!;
    models[id] = { ...m, profile: { ...m.profile!, chars: { ...m.profile!.chars, ...set } } };
  }
  t.s = { ...t.s, models };
  t.states.set(t.s.seq, t.s);
}

/** Give every close combat weapon (or one made up) these special rules. */
function melee(t: Table, unitId: string, keywords: string[]) {
  const u = t.s.units[unitId]!;
  const weapons = { blade: { id: "blade", name: "Blade", kind: "melee" as const, chars: {}, keywords } };
  const models = { ...t.s.models };
  for (const id of u.modelIds)
    models[id] = { ...models[id]!, weapons: [...(models[id]!.weapons ?? []), "blade"] };
  t.s = {
    ...t.s,
    models,
    units: {
      ...t.s.units,
      [unitId]: { ...u, sheet: { ...u.sheet!, weapons: { ...u.sheet!.weapons, ...weapons } } },
    },
  };
  t.states.set(t.s.seq, t.s);
}

/**
 * `unit` declares a charge at `target` 4" away in its Movement phase (the
 * target holds), then is moved into contact, and the Combat phase begins.
 */
function charged(t: Table, unit: string, target: string, player: "p1" | "p2" = "p1") {
  const at = (id: string) => t.s.models[t.s.units[id]!.modelIds[0]!]!.position.y;
  const y = at(target);
  const ahead = y > at(unit) ? 4 : -4;
  const facing = ahead > 0 ? Math.PI : 0;
  const files =
    t.s.units[target]!.formation.kind === "ranked"
      ? (t.s.units[target]!.formation as { files: number }).files
      : 1;
  block(t, target, y + ahead, files, facing);
  const seat = t.s.players[player]!.seat;
  const go = (phase: string) => {
    for (let i = 0; i < 20; i++) {
      if (t.s.turn.round > 0 && currentSlot(t.s)?.id === phase && t.s.turn.activeSeat === seat) return;
      t.play({ type: "turn/next" }, "p1");
    }
  };
  go("movement");
  t.play({ type: "script/start", force: true, procedure: "chargeReaction", args: { unit, target } }, player);
  if (t.s.script?.waiting) t.play({ type: "script/answer", answer: "hold" }, t.s.script.waiting.player);
  block(t, target, y, files, facing);
  go("combat");
}

const rolls = (t: Table, label: RegExp, unitId?: string) =>
  t.events.flatMap((e) =>
    e.type === "script/step"
      ? e.events.flatMap((x) =>
          x.type === "dice/roll" && label.test(x.roll.label ?? "") && (!unitId || x.roll.unitId === unitId)
            ? [x.roll]
            : [],
        )
      : [],
  );

/** A round of combat, answering any question with its first option. */
function fight(t: Table, a: string, b: string, seed: number) {
  t.play({ type: "script/start", procedure: "combat", args: { unit: a, target: b } }, "p1", seed);
  for (let i = 0; i < 6 && t.s.script?.waiting; i++)
    t.play(
      { type: "script/answer", answer: t.s.script.waiting.options[0]!.id },
      t.s.script.waiting.player,
      seed,
    );
}

const successes = (r: { results: number[]; need?: number }) =>
  r.results.filter((x) => x !== 1 && x >= (r.need ?? 7)).length;

const unitStat = (s: GameState, unitId: string, k: string) =>
  (view(s).unit(unitId) as Record<string, unknown> | undefined)?.[k];

describe("Old World universal special rules (#66)", () => {
  it("Ward save (X+) and Regeneration (X+) by name give the model those saves", () => {
    const { t, warband } = setup();
    expect(unitStat(t.s, warband, "ward")).toBe(0);
    rule(t, warband, "Ward save (5+)", "Regeneration (4+)");
    expect(unitStat(t.s, warband, "ward")).toBe(5);
    expect(unitStat(t.s, warband, "regen")).toBe(4);
    // A better ward it has already stays.
    chars(t, warband, { Ward: "4+" });
    expect(unitStat(t.s, warband, "ward")).toBe(4);
  });

  it("armour by name: light, heavy and full plate armour, a shield and barding one better each", () => {
    const { t, warband, spears } = setup();
    expect(unitStat(t.s, warband, "armour")).toBe(7);
    rule(t, warband, "Light Armour");
    expect(unitStat(t.s, warband, "armour")).toBe(6);
    rule(t, warband, "Shield");
    expect(unitStat(t.s, warband, "armour")).toBe(5);
    rule(t, spears, "Full Plate Armour", "Shield", "Barding");
    expect(unitStat(t.s, spears, "armour")).toBe(2);
  });

  it("Killing Blow: a natural 6 to wound slays infantry outright, with no armour save", () => {
    let seen = 0;
    for (let seed = 1; seed < 60 && !seen; seed++) {
      const { t, spears, warband } = setup();
      rule(t, spears, "Killing Blow");
      rule(t, warband, "Full Plate Armour");
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const wound = rolls(t, /^to wound$/, spears)[0];
      if (!wound) continue;
      const sixes = wound.results.filter((x) => x === 6).length;
      if (!sixes) continue;
      seen++;
      expect(t.notes().join(" ")).toMatch(new RegExp(`strikes ${sixes} Killing Blows?`));
      // Only the other wounds get an armour save.
      const armour = rolls(t, /^armour save$/, warband)[0];
      expect(armour?.results.length ?? 0).toBe(successes(wound) - sixes);
    }
    expect(seen).toBe(1);
    // Not against a monster.
    for (let seed = 1; seed < 20; seed++) {
      const { t, spears } = setup();
      const hulk = unitNamed(t.s, "Bog Hulk").id;
      rule(t, spears, "Killing Blow");
      block(t, hulk, 0.8, 1, Math.PI);
      toPhase(t, "combat");
      fight(t, spears, hulk, seed);
      expect(t.notes().join(" ")).not.toMatch(/Killing Blow/);
    }
  });

  it("Armour Bane (X) as the model's own rule: a natural 6 to wound saves X worse", () => {
    for (let seed = 1; seed < 40; seed++) {
      const { t, spears, warband } = setup();
      rule(t, spears, "Armour Bane (2)");
      rule(t, warband, "Full Plate Armour");
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const baned = rolls(t, /Armour Bane/, warband)[0];
      if (!baned) continue;
      // Full plate's 4+, two worse.
      expect(baned.need).toBe(6);
      return;
    }
    throw new Error("no natural 6 to wound");
  });

  it("Monster Slayer: a natural 6 to wound against a monster takes every Wound it has left", () => {
    for (let seed = 1; seed < 80; seed++) {
      const { t, spears } = setup();
      const hulk = unitNamed(t.s, "Bog Hulk").id;
      rule(t, spears, "Monster Slayer");
      block(t, hulk, 0.8, 1, Math.PI);
      toPhase(t, "combat");
      fight(t, spears, hulk, seed);
      if (!/Monster Slaying Blow/.test(t.notes().join(" "))) continue;
      const m = t.s.models[t.s.units[hulk]!.modelIds[0]!]!;
      expect(m.destroyed).toBe(true);
      return;
    }
    throw new Error("never struck a Monster Slaying Blow");
  });

  it("Poisoned Attacks: natural 6s to hit wound 2 more easily, in combat and when shooting", () => {
    let checked = 0;
    for (let seed = 1; seed < 30 && checked < 3; seed++) {
      const { t, spears, warband } = setup();
      melee(t, spears, ["Poisoned Attacks"]);
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const hit = rolls(t, /^to hit/, spears)[0]!;
      const sixes = hit.results.filter((x) => x === 6).length;
      const poison = rolls(t, /Poisoned Attacks \+2/, spears)[0];
      expect(poison?.results.length ?? 0).toBe(sixes);
      if (poison) {
        // S3 against T3: 4+ plain, 2+ poisoned.
        expect(poison.need).toBe(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // The shooting procedure: the wound die after a natural 6 to hit needs 2 less.
    const { t } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    const warband = unitNamed(t.s, "Reaver Warband").id;
    const u = t.s.units[bows]!;
    const missile = { ...u.sheet!.weapons.missile!, keywords: ["Poisoned Attacks"] };
    t.s = {
      ...t.s,
      units: {
        ...t.s.units,
        [bows]: { ...u, sheet: { ...u.sheet!, weapons: { ...u.sheet!.weapons, missile } } },
      },
    };
    block(t, bows, -10, 5, 0);
    block(t, warband, 4, 6, Math.PI);
    toPhase(t, "shooting");
    // T3 against S3: 4+ to wound, 2+ after a natural 6 to hit.
    let poisoned = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const before = t.s;
      t.play(
        { type: "action/take", unitId: bows, action: "shoot", weapon: "missile", targetId: warband },
        "p1",
        seed,
      );
      while (t.s.procedure && !t.s.procedure.run.done) t.play({ type: "procedure/roll" }, "p1", seed);
      const rec = (id: string) => t.s.procedure!.run.records.find((x) => x.id === id);
      const hits = (rec("hit")?.dice ?? []).filter((d) => d.success).map((d) => d.value);
      (rec("wound")?.dice ?? []).forEach((d, i) => {
        const need = hits[i] === 6 ? 2 : 4;
        if (hits[i] === 6) poisoned++;
        expect(d.success, `seed ${seed} die ${i}`).toBe(d.value !== 1 && d.value >= need);
      });
      t.s = before;
      t.states.set(t.s.seq, t.s);
    }
    expect(poisoned).toBeGreaterThan(0);
    expect(isAutomated(oldWorld, { name: "Poisoned Attacks", text: "" })).toBe(true);
  });

  it("Multiple Wounds (X): each unsaved wound costs X Wounds, none spilling to the next model", () => {
    for (let seed = 1; seed < 40; seed++) {
      const { t, spears } = setup();
      const brutes = unitNamed(t.s, "Tusk Brutes").id;
      block(t, brutes, 0.8, 3, Math.PI);
      melee(t, spears, ["Multiple Wounds (2)"]);
      toPhase(t, "combat");
      fight(t, spears, brutes, seed);
      const m = /Multiple Wounds: ([\d, ]+) Wounds/.exec(t.notes().join(" | "));
      if (!m) continue;
      const each = m[1]!.split(", ").map(Number);
      expect(each.every((x) => x === 2)).toBe(true);
      // Brutes have 3 Wounds each: two unsaved wounds take 4, which is one model and 2 Wounds off another, never 3 + 1.
      const lost = t.s.units[brutes]!.modelIds.map((id) => t.s.models[id]!.woundsLost ?? 0);
      expect(lost.every((w) => w === 0 || w === 2 || w === 3)).toBe(true);
      return;
    }
    throw new Error("no unsaved wound");
  });

  it("Flaming Attacks: a Flammable target gets no regeneration save", () => {
    for (let seed = 1; seed < 40; seed++) {
      const { t, spears, warband } = setup();
      rule(t, warband, "Regeneration (4+)", "Flammable");
      melee(t, spears, ["Flaming Attacks"]);
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      if (!/Flammable: no regeneration save/.test(t.notes().join(" "))) continue;
      expect(rolls(t, /regeneration save/, warband)).toEqual([]);
      return;
    }
    throw new Error("never wounded");
  });

  it("Strike First and Strike Last: Initiative 10 and 1 in combat", () => {
    const { t, spears, warband } = setup();
    rule(t, warband, "Strike First");
    rule(t, spears, "Strike Last");
    toPhase(t, "combat");
    fight(t, spears, warband, 1);
    const order = rolls(t, /^to hit/).map((r) => r.unitId);
    expect(order[0]).toBe(warband);
    expect(order.at(-1)).toBe(spears);
  });

  it('Furious Charge: +1 Attack in a turn it charged 3" or more', () => {
    const { t, spears, warband } = setup();
    rule(t, spears, "Furious Charge");
    charged(t, spears, warband);
    fight(t, spears, warband, 1);
    // Five files of one Attack, each +1, and five supporting attacks (Fight in Extra Rank).
    const hit = rolls(t, /Furious Charge \+1 Attack/, spears)[0]!;
    expect(hit.results.length).toBe(15);
    // In a turn it didn't charge, no bonus.
    const other = setup();
    rule(other.t, other.spears, "Furious Charge");
    toPhase(other.t, "combat");
    fight(other.t, other.spears, other.warband, 1);
    expect(rolls(other.t, /Furious Charge/)).toEqual([]);
  });

  it("Press of Battle: a unit in combat order that didn't charge fights two ranks deep", () => {
    const { t, spears, warband } = setup();
    rule(t, warband, "Press of Battle");
    toPhase(t, "combat");
    fight(t, spears, warband, 2);
    const hit = rolls(t, /Press of Battle/, warband)[0]!;
    // Six files, two ranks of one Attack each.
    expect(hit.results.length).toBe(12);
  });

  it("Parry improves armour by one in combat; a two-handed weapon gives up the shield", () => {
    const needs = (names: string[], keywords: string[]) => {
      const out: number[] = [];
      for (let seed = 1; seed < 8; seed++) {
        const { t, spears, warband } = setup();
        rule(t, warband, ...names);
        if (keywords.length) melee(t, warband, keywords);
        toPhase(t, "combat");
        fight(t, spears, warband, seed);
        out.push(...rolls(t, /^armour save$/, warband).map((r) => r.need!));
      }
      return [...new Set(out)];
    };
    // Light armour and a shield, 5+; Parry, 4+.
    expect(needs(["Light Armour", "Shield", "Parry"], [])).toEqual([4]);
    // Its only weapon needs two hands: no shield in combat, 6+.
    expect(needs(["Light Armour", "Shield", "Parry"], ["Requires Two Hands"])).toEqual([6]);
  });

  it("Impact Hits (X) when it charged; Stomp Attacks (X) after every other blow, Thunderstomp at AP -2", () => {
    const { t, spears } = setup();
    const hulk = unitNamed(t.s, "Bog Hulk").id;
    rule(t, hulk, "Impact Hits (D3)", "Stomp Attacks (2)", "Thunderstomp");
    block(t, hulk, 0.8, 1, Math.PI);
    toPhase(t, "combat");
    fight(t, spears, hulk, 4);
    // Not charging: no Impact Hits; the stomps come last, hitting automatically.
    expect(t.notes().join(" ")).not.toMatch(/Impact Hits/);
    expect(t.notes().join(" ")).toMatch(/Bog Hulk: 2 Stomp Attacks, hitting automatically at Strength 5/);
    const labels = rolls(t, /./).map((r) => r.label);
    const stomp = labels.findIndex((l) => /Stomp/.test(l ?? ""));
    expect(labels.slice(stomp).some((l) => /^to hit/.test(l ?? ""))).toBe(false);
    // Charging 3" or more: Impact Hits before the other blows.
    const c = setup();
    const hulk2 = unitNamed(c.t.s, "Bog Hulk").id;
    rule(c.t, hulk2, "Impact Hits (D3)");
    block(c.t, hulk2, 0.8, 1, Math.PI);
    charged(c.t, hulk2, c.spears, "p2");
    c.t.play({ type: "script/start", procedure: "combat", args: { unit: hulk2, target: c.spears } }, "p2", 4);
    const labels2 = rolls(c.t, /./).map((r) => r.label ?? "");
    const impact = labels2.indexOf("Impact Hits (D3)");
    // One model in contact, D3 hits, before anyone's blows.
    expect(rolls(c.t, /^Impact Hits/)[0]!.results.length).toBe(1);
    expect(labels2.findIndex((l) => /^to hit/.test(l))).toBeGreaterThan(impact);
  });

  it("Terror on the winning side: the losers' break test is at Leadership -1", () => {
    for (let seed = 1; seed < 40; seed++) {
      const { t, spears, warband } = setup();
      rule(t, warband, "Terror");
      chars(t, warband, { A: "3", S: "5" });
      toPhase(t, "combat");
      fight(t, spears, warband, seed);
      const line = t.notes().find((n) => /Marchwarden Spears break test/.test(n));
      if (!line) continue;
      expect(line).toMatch(/Terror: Ld -1/);
      return;
    }
    throw new Error("the Spears never lost");
  });

  it("Hatred (X) hates only the foes it names; Hatred (all enemies) everyone", () => {
    const { t, spears, warband } = setup();
    const u = (id: string, ...names: string[]) => ({
      ...t.s.units[id]!,
      sheet: { ...t.s.units[id]!.sheet!, abilities: names.map((name) => ({ name, text: "" })) },
    });
    const foe = {
      ...t.s.units[warband]!,
      sheet: { ...t.s.units[warband]!.sheet!, keywords: ["Faction: High Elf Realms"] },
    };
    expect(hatesFoe(u(spears, "Hatred (High Elves)"), foe)).toBe(true);
    expect(hatesFoe(u(spears, "Hatred (Orcs & Goblins)"), foe)).toBe(false);
    expect(hatesFoe(u(spears, "Hatred (all enemies)"), foe)).toBe(true);
    expect(hatesFoe(u(spears, "Hatred"), foe)).toBe(true);
  });

  it("Warband: its rank bonus on its Leadership, up to 10", () => {
    const { t, spears, warband } = setup();
    rule(t, warband, "Warband");
    toPhase(t, "combat");
    fight(t, spears, warband, 5);
    const line = t.notes().find((n) => /Reaver Warband (break|Fear|Panic) test/.test(n));
    if (line) expect(line).toMatch(/Warband \+\d/);
    // The rank bonus comes from five ranks of six: +2 on the Chief's 8.
    t.play({ type: "script/start", force: true, procedure: "panic", args: { unit: warband } }, "p2");
    expect(t.notes().join(" ")).toMatch(/Reaver Warband Panic test: 2D6 against Ld 10, .*Warband \+2/);
  });

  it("Horde: one more rank bonus than its troop type allows", () => {
    const { t, warband } = setup();
    expect(towRanks(t.s, t.s.units[warband]!).maxBonus).toBe(2);
    rule(t, warband, "Horde");
    expect(towRanks(t.s, t.s.units[warband]!).maxBonus).toBe(3);
  });

  it("Swiftstride: flee and pursuit rolls add D6", () => {
    const { t, spears, warband } = setup();
    rule(t, spears, "Swiftstride");
    block(t, warband, 8, 6, Math.PI);
    toPhase(t, "movement");
    t.play(
      {
        type: "script/start",
        force: true,
        procedure: "chargeReaction",
        args: { unit: warband, target: spears },
      },
      "p2",
    );
    t.play({ type: "script/answer", answer: "flee" }, "p1");
    expect(rolls(t, /flee roll: Swiftstride \+D6/).length).toBe(1);
    expect(towReminders(view(t.s)).some((w) => w.id === "towSwiftstride")).toBe(false);
  });

  it("Move Through Cover isn't slowed by difficult ground; Iron Shod Wheels can't cross obstacles", () => {
    const sys = getSystem("tow-hand");
    const difficult = sys.terrain!.find((c) => c.id === "difficult")!;
    expect(difficult.movement).toEqual([{ keywords: ["Move Through Cover"] }]);
    const wall = sys.terrain!.find((c) => c.id === "lowObstacle")!;
    expect(wall.movement).toEqual([{ keywords: ["Iron Shod Wheels"], blocks: true }]);
  });

  it("Clumsy, Loner, Unbreakable: who may join whom", () => {
    const { t, spears } = setup();
    const marshal = unitNamed(t.s, "Fen Marshal");
    const with_ = (u: Unit, ...names: string[]) => ({
      ...u,
      sheet: { ...u.sheet!, abilities: names.map((name) => ({ name, text: "" })) },
    });
    const regiment = t.s.units[spears]!;
    expect(joinBar(marshal, regiment)).toBeNull();
    expect(joinBar(marshal, with_(regiment, "Clumsy"))).toMatch(/Clumsy/);
    expect(joinBar(with_(marshal, "Clumsy"), with_(regiment, "Clumsy"))).toBeNull();
    expect(joinBar(with_(marshal, "Loner"), regiment)).toMatch(/Loner/);
    expect(joinBar(marshal, with_(regiment, "Unbreakable"))).toMatch(/Unbreakable/);
  });

  it("Magic Resistance (-X): an enemy spell at the unit casts at -X", () => {
    const { t, spears, warband } = setup();
    rule(t, warband, "Magic Resistance (-2)");
    toPhase(t, "shooting");
    t.play({ type: "script/start", procedure: "castSpell", args: { unit: spears, target: warband } }, "p1");
    expect(t.notes().join(" ")).toMatch(/Reaver Warband has Magic Resistance: -2 to the casting roll/);
    expect(magicActions.length).toBeGreaterThan(0);
  });

  it("Large Target: no cover from shooting", () => {
    const { t } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    const warband = unitNamed(t.s, "Reaver Warband").id;
    block(t, bows, -10, 5, 0);
    block(t, warband, 4, 6, Math.PI);
    toPhase(t, "shooting");
    t.s = {
      ...t.s,
      terrain: [
        {
          id: "w",
          name: "Woods",
          category: "woods",
          position: { x: 0, y: 6 },
          width: 8,
          depth: 10,
          facing: 0,
          solids: [],
        },
      ],
    };
    const plan = () =>
      previewRun(
        procedureEnv(t.s),
        "shoot",
        procedureRoles(getSystem("tow-hand"), "shoot", bows, { weapon: "missile", targetId: warband }),
      );
    expect(plan().fired.hit).toEqual(["Full cover"]);
    rule(t, warband, "Large Target");
    expect(plan().fired.hit ?? []).toEqual([]);
  });

  it("formations: a unit listing Close Order, Open Order or Skirmishers is warned in any other", () => {
    const { t, spears } = setup();
    expect(formationWarning(t.s.units[spears]!)).toBeNull();
    rule(t, spears, "Skirmishers");
    expect(formationWarning(t.s.units[spears]!)).toMatch(
      /close order, but its rules allow only a skirmish formation/,
    );
    rule(t, spears, "Close Order");
    expect(formationWarning(t.s.units[spears]!)).toBeNull();
  });

  it("an imported list shows these rules as automated, by name", () => {
    for (const name of [
      "Fear",
      "Terror",
      "Frenzy",
      "Hatred (High Elves)",
      "Stubborn",
      "Unbreakable",
      "Immune To Psychology",
      "Killing Blow",
      "Poisoned Attacks",
      "Armour Bane (1)",
      "Regeneration (5+)",
      "Ward save (4+)",
      "Heavy Armour",
      "Shield",
      "Swiftstride",
      "Skirmishers",
      "Magic Resistance (-1)",
      "Stomp Attacks (D3)",
    ])
      expect(isAutomated(oldWorld, { name, text: "Their own words." }), name).toBe(true);
    // A fear the unit has isn't one it causes; a rule we don't play stays a reminder.
    expect(isAutomated(oldWorld, { name: "Fear of Elves", text: "" })).toBe(false);
    expect(isAutomated(oldWorld, { name: "Regeneration", text: "no number" })).toBe(false);
    expect(isAutomated(oldWorld, { name: "Scouts", text: "" })).toBe(false);
  });
});
