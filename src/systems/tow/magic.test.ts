import { describe, expect, it } from "vitest";
import { gameView } from "../../core/script";
import type { GameState } from "../../core";
import { towActions } from "./combat";
import { magicActions, spellsInPlay } from "./magic";
import { block, setup, toPhase, unitNamed, type Table } from "./testing";

const cast = magicActions.find((a) => a.id === "castSpell")!;
const view = (s: GameState) => gameView(s, "tow-hand");
const START = "hook:tow-hand:phaseStart:strategy";

/** Give a unit a special rule by name, as a roster would. */
function rule(t: Table, unitId: string, name: string) {
  const u = t.s.units[unitId]!;
  const sheet = { ...u.sheet!, abilities: [...u.sheet!.abilities, { name, text: "" }] };
  t.s = { ...t.s, units: { ...t.s.units, [unitId]: { ...u, sheet } } };
  t.states.set(t.s.seq, t.s);
}

/** Make a unit's models count for more Unit Strength each. */
function bigger(t: Table, unitId: string, us: number) {
  const models = { ...t.s.models };
  for (const id of t.s.units[unitId]!.modelIds)
    models[id] = {
      ...models[id]!,
      profile: { ...models[id]!.profile!, chars: { ...models[id]!.profile!.chars, US: String(us) } },
    };
  t.s = { ...t.s, models };
  t.states.set(t.s.seq, t.s);
}

const rolls = (t: Table, label: RegExp) =>
  t.events.flatMap((e) =>
    e.type === "script/step"
      ? e.events.flatMap((x) => (x.type === "dice/roll" && label.test(x.roll.label ?? "") ? [x.roll] : []))
      : [],
  );
const sum = (r: { results: number[] }) => r.results.reduce((a, b) => a + b, 0);

describe("Old World magic", () => {
  it("each kind of spell is cast in its own phase, at targets in range", () => {
    const { t, spears, warband } = setup();
    const offered = () => cast.available(view(t.s), { player: "p1", unitId: spears });
    const targets = () => cast.targets!(view(t.s), { player: "p1", unitId: spears }).map((x) => x.label);
    toPhase(t, "strategy");
    expect(offered()).toBe(true);
    expect(targets()[0]).toBe("Ward of Thorns on itself");
    toPhase(t, "movement");
    expect(targets()[0]).toMatch(/Mire Step/);
    toPhase(t, "shooting");
    expect(cast.targets!(view(t.s), { player: "p1", unitId: spears })[0]!.unitId).toBe(warband);
    toPhase(t, "combat");
    expect(offered()).toBe("No spells of this phase's kind");
    // The enemy's wizard waits for its own turn.
    expect(cast.available(view(t.s), { player: "p2", unitId: warband })).toBe("Only in your own turn");
    // No spells, no action.
    const brutes = unitNamed(t.s, "Tusk Brutes").id;
    expect(cast.applies!(view(t.s), { player: "p2", unitId: brutes })).toBe(false);
  });

  it("casting: 2D6 + level against the casting value, a dispel window, then the hits", () => {
    const seen = { failed: 0, letThrough: 0, dispelled: 0, kept: 0, irresistible: 0 };
    for (let seed = 1; seed < 120; seed++) {
      const { t, spears, warband } = setup();
      toPhase(t, "shooting");
      t.play(
        { type: "script/start", procedure: "castSpell", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      const total = sum(rolls(t, /^cast Spark Lance/)[0]!) + 2;
      const text = () => t.notes().join(" | ");
      const q = t.s.script?.waiting;
      if (/Spark Lance fails/.test(text())) {
        seen.failed++;
        expect(total < 8 || rolls(t, /^cast/)[0]!.results.every((x) => x === 1)).toBe(true);
        expect(q).toBeFalsy();
      } else if (/irresistible force/.test(text())) {
        seen.irresistible++;
        expect(q).toBeFalsy();
        expect(text()).toMatch(/Miscast \(\d+\)/);
      } else {
        // The Reaver player may dispel with their Bone Shaman's warband, or let it through.
        expect(q?.player).toBe("p2");
        expect(q!.options.map((o) => o.id)).toEqual([warband, "no"]);
        const dispel = seed % 2 === 0;
        t.play({ type: "script/answer", answer: dispel ? warband : "no" }, "p2", seed + 1);
        if (!dispel) {
          seen.letThrough++;
          expect(text()).toMatch(/Spark Lance: \d Strength 4 hits on Reaver Warband/);
        } else {
          const d = rolls(t, /^dispel Spark Lance/)[0]!;
          const ok = !d.results.every((x) => x === 1) && sum(d) + 1 >= total;
          expect(/Reaver Warband dispels Spark Lance/.test(text())).toBe(ok);
          if (ok) seen.dispelled++;
          else seen.kept++;
        }
      }
      expect(t.s.script).toBeNull();
      // Each spell once a turn.
      expect(cast.available(view(t.s), { player: "p1", unitId: spears })).toMatch(
        /Tried each|Drained|No target/,
      );
    }
    expect(seen.failed && seen.letThrough && seen.dispelled && seen.kept).toBeTruthy();
  });

  it("enchantments and hexes mark their target, end at the caster's next turn, or remain until dispelled", () => {
    for (let seed = 1; seed < 60; seed++) {
      const { t, spears, warband } = setup();
      toPhase(t, "strategy");
      t.play(
        { type: "script/start", procedure: "castSpell", args: { unit: spears, target: spears } },
        "p1",
        seed,
      );
      if (t.s.script?.waiting) t.play({ type: "script/answer", answer: "no" }, "p2");
      if (!t.s.units[spears]!.status?.["spell:Ward of Thorns"]) continue;
      expect(spellsInPlay(view(t.s))).toMatchObject([{ spell: "Ward of Thorns", remains: false }]);
      // The other side's turn starts: still there. Ours: it ends.
      t.play({ type: "script/start", procedure: START, args: { player: "p2" } }, "p2");
      expect(t.s.units[spears]!.status?.["spell:Ward of Thorns"]).toBe(true);
      t.play({ type: "script/start", procedure: START, args: { player: "p1" } }, "p1");
      expect(t.s.units[spears]!.status?.["spell:Ward of Thorns"]).toBeUndefined();
      expect(spellsInPlay(view(t.s))).toEqual([]);
      void warband;
      return;
    }
    throw new Error("never cast");
  });

  it("a spell that remains in play can be dispelled by an enemy wizard in its own turn", () => {
    for (let seed = 1; seed < 80; seed++) {
      const { t, spears, warband } = setup();
      // The Reavers' turn: Leaden Limbs (remains in play) on the Marchwarden Spears.
      for (let i = 0; i < 20 && !(t.s.turn.activeSeat === 1 && t.s.turn.round > 0); i++)
        t.play({ type: "turn/next" }, "p1");
      expect(view(t.s).phase).toBe("strategy");
      t.play(
        { type: "script/start", procedure: "castSpell", args: { unit: warband, target: spears } },
        "p2",
        seed,
      );
      if (t.s.script?.waiting) t.play({ type: "script/answer", answer: "no" }, "p1");
      if (!t.s.units[spears]!.status?.["spell:Leaden Limbs"]) continue;
      t.play({ type: "script/start", procedure: START, args: { player: "p2" } }, "p2");
      expect(t.s.units[spears]!.status?.["spell:Leaden Limbs"]).toBe(true);
      const dispel = magicActions.find((a) => a.id === "dispelInPlay")!;
      toPhase(t, "strategy");
      expect(dispel.available(view(t.s), { player: "p1", unitId: spears })).toBe(true);
      t.play(
        { type: "script/start", procedure: "dispelInPlay", args: { unit: spears, target: spears } },
        "p1",
        seed,
      );
      expect(t.notes().join(" ")).toMatch(
        /Leaden Limbs on Marchwarden Spears ends|fails to dispel Leaden Limbs/,
      );
      expect(dispel.available(view(t.s), { player: "p1", unitId: spears })).not.toBe(true);
      return;
    }
    throw new Error("never cast");
  });
});

describe("Old World psychology", () => {
  it("Fear: a test to charge a Fear-causing enemy with the higher Unit Strength; failing it stops the charge for the turn", () => {
    const seen = { afraid: 0, brave: 0 };
    for (let seed = 1; seed < 40; seed++) {
      const { t, spears } = setup();
      const brutes = unitNamed(t.s, "Tusk Brutes").id;
      block(t, brutes, 8, 3, Math.PI);
      // Not afraid of a smaller unit: the Brutes' 18 against the Spears' 25.
      if (seed === 1) {
        const before = t.events.length;
        t.play(
          {
            type: "script/start",
            force: true,
            procedure: "chargeReaction",
            args: { unit: spears, target: brutes },
          },
          "p1",
        );
        expect(t.events.slice(before).some((e) => JSON.stringify(e).includes("Fear test"))).toBe(false);
        continue;
      }
      bigger(t, brutes, 5);
      toPhase(t, "movement");
      t.play(
        { type: "script/start", procedure: "chargeReaction", args: { unit: spears, target: brutes } },
        "p1",
        seed,
      );
      const r = rolls(t, /^Fear test$/)[0]!;
      const charge = towActions.find((a) => a.id === "chargeReaction")!;
      if (sum(r) > 9 && !t.s.script?.waiting) {
        seen.afraid++;
        expect(t.notes().join(" ")).toMatch(/too afraid of Tusk Brutes to charge/);
        expect(charge.available(view(t.s), { player: "p1", unitId: spears })).toBe(
          "Failed its Fear test this turn",
        );
      } else if (t.s.script?.waiting) {
        seen.brave++;
        expect(t.s.script.waiting.player).toBe("p2");
      }
    }
    expect(seen.afraid && seen.brave).toBeTruthy();
  });

  it("Fear in combat: a failed test means -1 to hit", () => {
    for (let seed = 1; seed < 40; seed++) {
      const { t, spears, warband } = setup();
      rule(t, warband, "Fear");
      toPhase(t, "combat");
      t.play(
        { type: "script/start", procedure: "combat", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      if (!/afraid of Reaver Warband/.test(t.notes().join(" "))) continue;
      expect(rolls(t, /afraid: -1 to hit/).length).toBe(1);
      return;
    }
    throw new Error("never afraid");
  });

  it("Terror: charged by it, a failed test means fleeing; Immune to Psychology can't flee", () => {
    let fled = 0;
    for (let seed = 1; seed < 40 && !fled; seed++) {
      const { t, spears, warband } = setup();
      rule(t, warband, "Terror");
      t.play(
        {
          type: "script/start",
          force: true,
          procedure: "chargeReaction",
          args: { unit: warband, target: spears },
        },
        "p2",
        seed,
      );
      const r = rolls(t, /^Terror test/).at(-1)!;
      if (sum(r) > 9) {
        fled++;
        expect(t.s.units[spears]!.status?.fleeing).toBe(true);
        expect(t.s.script).toBeNull();
      }
    }
    expect(fled).toBe(1);
    const { t, spears, warband } = setup();
    rule(t, spears, "Immune to Psychology");
    rule(t, warband, "Terror");
    t.play(
      {
        type: "script/start",
        force: true,
        procedure: "chargeReaction",
        args: { unit: warband, target: spears },
      },
      "p2",
    );
    expect(rolls(t, /Terror/)).toEqual([]);
    // Hold is all it can do: no question, and the log says why (UX 260).
    expect(t.s.script).toBeNull();
    expect(t.notes().join(" | ")).toMatch(/holds: units immune to psychology don't flee/);
    toPhase(t, "combat");
    const panic = towActions.find((a) => a.id === "panic")!;
    expect(panic.available(view(t.s), { player: "p1", unitId: spears })).toBe("Immune to Psychology");
  });

  it("Frenzy adds an Attack in a turn it charged; Hatred re-rolls misses the first time it fights a foe", () => {
    const { t, spears, warband } = setup();
    rule(t, spears, "Frenzy");
    rule(t, spears, "Hatred (all enemies)");
    toPhase(t, "combat");
    t.s = { ...t.s, units: { ...t.s.units, [spears]: { ...t.s.units[spears]!, status: { charged: true } } } };
    t.states.set(t.s.seq, t.s);
    t.play({ type: "script/start", procedure: "combat", args: { unit: spears, target: warband } }, "p1", 3);
    if (t.s.script?.waiting) t.play({ type: "script/answer", answer: "restrain" }, t.s.script.waiting.player);
    const hit = rolls(t, /^to hit .*Frenzy/)[0]!;
    // 5 files of 2 Attacks (1 + Frenzy) and 5 supporting attacks.
    expect(hit.results.length).toBe(15);
    expect(t.notes().join(" ")).toMatch(/hates Reaver Warband/);
    if (hit.results.some((x) => x < 4)) expect(rolls(t, /Hatred/).length).toBe(1);
  });

  it('the General lends Leadership within 12"; the Battle Standard re-rolls a failed test', () => {
    const { t } = setup();
    const slingers = unitNamed(t.s, "Reaver Slingers").id;
    block(t, slingers, 6, 5, Math.PI);
    t.play({ type: "script/start", force: true, procedure: "panic", args: { unit: slingers } }, "p2");
    expect(t.notes()[0]).toMatch(/against Ld 8, the General's, Reaver Warband/);

    let rerolled = 0;
    for (let seed = 1; seed < 40; seed++) {
      const { t: s, spears } = setup();
      rule(s, spears, "Battle Standard Bearer");
      s.play({ type: "script/start", force: true, procedure: "panic", args: { unit: spears } }, "p1", seed);
      const tests = rolls(s, /^Panic test/);
      expect(tests.length).toBe(sum(tests[0]!) > 9 ? 2 : 1);
      if (tests.length === 2) rerolled++;
    }
    expect(rerolled).toBeGreaterThan(0);
  });

  it("Stupidity is tested at the start of the unit's turn", () => {
    const seen = { stupid: 0, fine: 0 };
    for (let seed = 1; seed < 40; seed++) {
      const { t } = setup();
      const brutes = unitNamed(t.s, "Tusk Brutes").id;
      rule(t, brutes, "Stupidity");
      block(t, brutes, 6, 3, Math.PI);
      t.play({ type: "script/start", procedure: START, args: { player: "p2" } }, "p2", seed);
      const r = rolls(t, /^Stupidity test/)[0]!;
      // The Brutes stand within 12" of their General (Ld 8).
      expect(!!t.s.units[brutes]!.status?.stupid).toBe(sum(r) > 8);
      const charge = towActions.find((a) => a.id === "chargeReaction")!;
      if (t.s.units[brutes]!.status?.stupid) {
        seen.stupid++;
        // A stupid unit can't declare a charge (UX 259).
        expect(charge.available(view(t.s), { player: "p2", unitId: brutes })).toBe(
          "Stupid this turn: it can't declare a charge",
        );
      } else seen.fine++;
    }
    expect(seen.stupid && seen.fine).toBeTruthy();
  });
});
