import { describe, expect, it } from "vitest";
import {
  collectTestModifiers,
  evaluate,
  num,
  validateSystem,
  type ContentPack,
  type EvalContext,
  type Expr,
} from "./index";
import { fortyK } from "./examples/forty-k";
import { conquestLike, oldWorldLike } from "./examples/rank-and-flank";
import { fsd } from "./examples/fsd";

const step = (system: typeof fortyK, procedure: string, id: string) => {
  const s = system.procedures.find((p) => p.id === procedure)?.steps.find((x) => x.id === id);
  if (!s || s.kind !== "test") throw new Error(`no test step ${id}`);
  return s;
};

describe("40k mechanics as data", () => {
  const wound = step(fortyK, "attack", "wound");
  const save = step(fortyK, "attack", "save");

  it("derives the wound roll from strength and toughness", () => {
    const targets = [8, 5, 4, 3, 2].map((S) =>
      num(wound.target, { scope: { weapon: { S }, target: { T: 4 } } }),
    );
    expect(targets).toEqual([2, 3, 4, 5, 6]);
  });

  it("applies AP and invulnerable saves", () => {
    const saveFor = (Sv: number, AP: number, InSv = 0) => {
      const ctx = { scope: { model: { Sv, InSv }, weapon: { AP } } };
      return evaluate(save.impossibleIf as Expr, ctx) ? null : num(save.target, ctx);
    };
    expect(saveFor(3, -1)).toBe(4);
    expect(saveFor(3, -4, 4)).toBe(4);
    expect(saveFor(4, -3)).toBeNull();
  });

  it("folds weapon keyword effects into a test, capping modifiers at ±1", () => {
    const rule = (id: string) => fortyK.rules.find((r) => r.id === id)!;
    const effects = [...rule("anti").effects, ...rule("heavy").effects, ...rule("twinLinked").effects];
    const ctx = (keywords: string[]): EvalContext => ({
      scope: {
        param: { keyword: "VEHICLE", threshold: 4 },
        target: { keywords },
        attacker: { unit: { inchesMoved: 0 } },
      },
    });
    const wound = collectTestModifiers(effects, "step.before", { step: "wound" }, ctx(["VEHICLE"]), 1);
    expect(wound).toMatchObject({ criticalOn: 4, reroll: "failed" });
    expect(
      collectTestModifiers(effects, "step.before", { step: "wound" }, ctx(["INFANTRY"]), 1).criticalOn,
    ).toBeNull();

    const doubled = [...rule("heavy").effects, ...rule("heavy").effects];
    expect(collectTestModifiers(doubled, "step.before", { step: "hit" }, ctx([]), 1).modifier).toBe(1);
  });

  it("checks coherency through the geometry hook", () => {
    const coherency = fortyK.checks!.find((c) => c.id === "coherency")!;
    const line = (xs: number[]) => xs.map((x) => ({ x }));
    const ctx = (models: { x: number }[]): EvalContext => ({
      scope: { self: { models } },
      geometry: (q, c) => {
        if (q.kind !== "distance") throw new Error(q.kind);
        const a = c.scope[q.from] as { x: number };
        const b = c.scope[q.to] as { x: number };
        return Math.abs(a.x - b.x);
      },
    });
    expect(evaluate(coherency.require, ctx(line([0, 2, 4])))).toBe(true);
    expect(evaluate(coherency.require, ctx(line([0, 2, 7])))).toBe(false); // gap of 5"
    expect(evaluate(coherency.require, ctx(line([0, 2, 4, 6, 8, 10])))).toBe(false); // spread over 9"
  });
});

describe("other systems fit the same schema", () => {
  it("looks up The Old World style to-hit chart", () => {
    const hit = step(oldWorldLike, "shoot", "hit");
    const ctx = (BS: number): EvalContext => ({
      scope: { attacker: { BS } },
      tables: Object.fromEntries((oldWorldLike.tables ?? []).map((t) => [t.id, t])),
    });
    expect([1, 3, 5, 7].map((bs) => num(hit.target, ctx(bs)))).toEqual([6, 4, 2, 2]);
  });

  it("uses roll-under tests for Conquest style", () => {
    const defense = step(conquestLike, "clash", "defense");
    expect(defense.compare).toBe("atMost");
    expect(num(defense.target, { scope: { target: { D: 3 }, weapon: { cleave: 1 } } })).toBe(2);
  });

  it("opposes FSD saves to the hit roll and strips save dice with AP", () => {
    const save = step(fsd, "attack", "save");
    // Five DU away: not close combat, so only the weapon's AP counts.
    const ctx = {
      scope: { input: { value: 7 }, target: { saveDice: 2 }, weapon: { AP: 1 } },
      geometry: () => 5,
    };
    expect(num(save.target, ctx)).toBe(7);
    expect(save.keep).toBe("highest");
    expect(num(save.dicePerInput!, ctx)).toBe(1);
  });

  it("validates every example system", () => {
    for (const system of [fortyK, oldWorldLike, conquestLike, fsd]) {
      expect(validateSystem(system), system.id).toEqual([]);
    }
  });

  it("flags broken references in an imported pack", () => {
    const pack: ContentPack = {
      id: "demo",
      name: "Demo",
      version: "1",
      system: fortyK.id,
      units: {
        squad: {
          id: "squad",
          name: "Line squad",
          keywords: ["INFANTRY"],
          models: [{ model: "trooper", min: 5, max: 10 }],
          rules: [],
        },
      },
      models: {
        trooper: {
          id: "trooper",
          name: "Trooper",
          characteristics: { M: 6, T: 3, Sv: 5, W: 1, Ld: 7, OC: 2, Speed: 4 },
          base: { shape: "round", diameterMm: 25 },
          weapons: ["rifle"],
        },
      },
      weapons: {
        rifle: {
          id: "rifle",
          name: "Rifle",
          kind: "ranged",
          characteristics: { range: 24, A: "1", skill: 4, S: 3, AP: 0, D: "1" },
          rules: [{ rule: "rapidFire", params: { x: "1" } }, { rule: "overheat" }],
        },
      },
    };
    expect(validateSystem(fortyK, [pack])).toEqual([
      'model trooper: unknown characteristic "Speed"',
      'weapon rifle: unknown rule "overheat"',
    ]);
  });
});
