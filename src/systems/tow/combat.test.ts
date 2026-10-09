import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, type GameEvent, type GameState } from "../../core";
import { buildLog } from "../../ui/gameLog";
import { gameView } from "../../core/script";
import { combatHit, toWound } from "./combatKit";
import { supportingAttacks } from "./wounds";
import { towActions } from "./combat";
import { block, setup, standing, toPhase, unitNamed } from "./testing";

describe("The Old World combat as code", () => {
  it("to hit and to wound tables", () => {
    // The Weapon Skill chart, spot checks.
    expect(combatHit(4, 3)).toBe(3);
    expect(combatHit(3, 3)).toBe(4);
    expect(combatHit(3, 7)).toBe(5);
    expect(combatHit(1, 3)).toBe(5);
    expect(combatHit(3, 1)).toBe(2);
    expect(combatHit(10, 10)).toBe(4);
    expect(combatHit(7, 3)).toBe(2);
    expect(toWound(3, 3)).toBe(4);
    expect(toWound(5, 3)).toBe(2);
    expect(toWound(3, 6)).toBe(6);
    expect(toWound(3, 7)).toBeNull();
  });

  it("supporting attacks: Fight in Extra Rank only, the rank behind, none into a flank or rear", () => {
    const { t, spears, warband } = setup();
    const view = () => gameView(t.s, "tow-hand");
    const u = (id: string) => t.s.units[id]!;
    // The sample spears Fight in Extra Rank: the second rank of five supports.
    expect(supportingAttacks(view(), u(spears), u(warband))).toBe(5);
    // The warband has no such weapon or rule.
    expect(supportingAttacks(view(), u(warband), u(spears))).toBe(0);
    const sheet = u(warband).sheet!;
    t.s = {
      ...t.s,
      units: {
        ...t.s.units,
        [warband]: {
          ...u(warband),
          sheet: { ...sheet, abilities: [...sheet.abilities, { name: "Fight in Extra Rank", text: "" }] },
        },
      },
    };
    expect(supportingAttacks(view(), u(warband), u(spears))).toBe(6);
    // The warband turned about: the spears strike its rear, with no support.
    block(t, warband, 4.8, 6, 0);
    expect(supportingAttacks(view(), u(spears), u(warband))).toBe(0);
  });

  it("a unit that has moved can't declare a charge (UX 323)", () => {
    const { t, spears, warband } = setup();
    block(t, warband, 10, 6, Math.PI);
    toPhase(t, "movement");
    const declare = towActions.find((a) => a.id === "chargeReaction")!;
    const actor = { player: "p1", unitId: spears };
    expect(declare.available(gameView(t.s, "tow-hand"), actor)).toBe(true);
    const moves = t.s.units[spears]!.modelIds.map((id) => ({
      id,
      to: { x: t.s.models[id]!.position.x, y: t.s.models[id]!.position.y + 1 },
    }));
    t.play({ type: "models/move", moves }, "p1");
    expect(declare.available(gameView(t.s, "tow-hand"), actor)).toMatch(/already moved this turn/);
  });

  it("a round of combat: strikes, casualties off the rear, the result and a break test", () => {
    const { t, spears, warband } = setup();
    toPhase(t, "combat");
    const before = [standing(t.s, spears), standing(t.s, warband)];
    t.play({ type: "script/start", procedure: "combat", args: { unit: spears, target: warband } }, "p1", 3);
    // If the loser broke, the winner is asked whether to pursue.
    if (t.s.script?.waiting) {
      const winner = t.s.script.waiting.player;
      expect(t.s.script.waiting.options.map((o) => o.id)).toEqual(["go", "restrain"]);
      t.play({ type: "script/answer", answer: "restrain" }, winner, 4);
    }
    expect(t.s.script).toBeNull();
    const notes = t.notes();
    expect(notes.some((n) => n.startsWith("Combat result: Marchwarden Spears"))).toBe(true);
    const after = [standing(t.s, spears), standing(t.s, warband)];
    expect(after[0]! + after[1]!).toBeLessThan(before[0]! + before[1]!);
    // The front rank is untouched: casualties came off the back.
    const front = t.s.units[warband]!.modelIds.slice(0, 6);
    expect(front.every((id) => !t.s.models[id]!.destroyed)).toBe(true);
    // One of the break test's three outcomes, or a draw.
    expect(notes.some((n) => /breaks and flees|falls back in good order|gives ground|draw/.test(n))).toBe(
      true,
    );
  });

  it("adds combat order and the high ground; Stubborn and Unbreakable don't take break tests (#40)", () => {
    const withRule = (t: ReturnType<typeof setup>["t"], id: string, name: string) => {
      const u = t.s.units[id]!;
      t.s = {
        ...t.s,
        units: { ...t.s.units, [id]: { ...u, sheet: { ...u.sheet!, abilities: [{ name, text: "" }] } } },
      };
      t.states.set(t.s.seq, t.s);
    };
    const fight = (rule: string | null, seed: number) => {
      const { t, spears, warband } = setup();
      if (rule) {
        withRule(t, spears, rule);
        withRule(t, warband, rule);
      }
      // The spears' front rank stands a little higher (on a hill's crest).
      const models = { ...t.s.models };
      for (const id of t.s.units[spears]!.modelIds) models[id] = { ...models[id]!, z: 1 };
      t.s = { ...t.s, models };
      t.states.set(t.s.seq, t.s);
      toPhase(t, "combat");
      t.play(
        { type: "script/start", procedure: "combat", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      if (t.s.script?.waiting)
        t.play({ type: "script/answer", answer: "restrain" }, t.s.script.waiting.player, 4);
      return { t, spears, warband };
    };
    const plain = fight(null, 3);
    const result = plain.t.notes().find((n) => n.startsWith("Combat result:"))!;
    expect(result).toMatch(/Marchwarden Spears \d+ \([^)]*high ground \+1/);
    // Unit Strength 10 or more in a block at least as wide as deep.
    expect(result).toMatch(/combat order \+1/);
    let unbroken = 0;
    let stubborn = 0;
    for (let seed = 1; seed < 12; seed++) {
      const u = fight("Unbreakable", seed).t.notes();
      if (u.some((n) => /is Unbreakable: no break test, it gives ground/.test(n))) unbroken++;
      expect(u.some((n) => /break test/.test(n) && /rolled/.test(n))).toBe(false);
      const st = fight("Stubborn", seed);
      if (st.t.notes().some((n) => /is Stubborn/.test(n))) {
        stubborn++;
        const lost = [st.spears, st.warband].find((id) => st.t.s.units[id]!.status?.stubbornUsed);
        expect(lost).toBeTruthy();
      }
    }
    expect(unbroken).toBeGreaterThan(0);
    expect(stubborn).toBeGreaterThan(0);
  });

  it("charging adds +1 Initiative per full inch, up to +3 into the front", () => {
    const { t, spears, warband } = setup();
    // Pull the warband back 2.5" so the charge has distance, declare, then close in.
    toPhase(t, "movement");
    block(t, warband, 3.3, 6, Math.PI);
    t.play(
      { type: "script/start", procedure: "chargeReaction", args: { unit: spears, target: warband } },
      "p1",
    );
    t.play({ type: "script/answer", answer: "hold" }, "p2");
    block(t, warband, 0.8, 6, Math.PI);
    toPhase(t, "combat");
    t.play({ type: "script/start", procedure: "combat", args: { unit: spears, target: warband } }, "p1", 5);
    expect(t.notes()).toContain("Marchwarden Spears charged: Initiative +2");
  });

  it("charge reactions: the charged unit's player chooses, and fleeing rolls the flee distance", () => {
    const { t, spears, warband } = setup();
    toPhase(t, "movement");
    t.play(
      { type: "script/start", procedure: "chargeReaction", args: { unit: spears, target: warband } },
      "p1",
    );
    const waiting = t.s.script!.waiting!;
    expect(waiting.player).toBe("p2");
    expect(waiting.options.map((o) => o.id)).toEqual(["hold", "flee"]); // no missile weapons
    expect(() => t.play({ type: "script/answer", answer: "flee" }, "p1")).toThrow();
    t.play({ type: "script/answer", answer: "flee" }, "p2", 9);
    expect(t.s.units[spears]!.status?.charged).toBe(true);
    expect(t.s.units[warband]!.status?.fleeing).toBe(true);
    const step = t.events.at(-1)!;
    const roll = step.type === "script/step" && step.events.find((e) => e.type === "dice/roll");
    expect(roll && roll.type === "dice/roll" && roll.roll.label === "flee roll" && roll.roll.unitId).toBe(
      warband,
    );
  });

  it("fleeing moves the unit straight away from the charger by the flee roll (UX 84)", () => {
    const { t, spears, warband } = setup();
    toPhase(t, "movement");
    // The unit's centre: fleeing turns it about, so its old front rank ends up at the back.
    const y = (s: GameState) => {
      const ids = s.units[warband]!.modelIds.filter((id) => !s.models[id]!.destroyed);
      return ids.reduce((a, id) => a + s.models[id]!.position.y, 0) / ids.length;
    };
    const y0 = y(t.s);
    t.play(
      { type: "script/start", procedure: "chargeReaction", args: { unit: spears, target: warband } },
      "p1",
    );
    t.play({ type: "script/answer", answer: "flee" }, "p2", 9);
    const step = t.events.at(-1)!;
    const roll = step.type === "script/step" && step.events.find((e) => e.type === "dice/roll");
    const total = roll && roll.type === "dice/roll" ? roll.roll.results.reduce((a, b) => a + b, 0) : 0;
    // The spears are south of the warband, so it runs north.
    expect(y(t.s) - y0).toBeCloseTo(total, 0);
    // A fleeing unit can't be fought.
    toPhase(t, "combat");
    const fight = towActions.find((a) => a.id === "combat")!;
    expect(fight.available(gameView(t.s, "tow-hand"), { unitId: spears } as never)).not.toBe(true);
  });

  it("missile troops may stand and shoot", () => {
    const { t, warband } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    toPhase(t, "movement");
    t.play(
      { type: "script/start", procedure: "chargeReaction", args: { unit: warband, target: bows } },
      "p2",
    );
    expect(t.s.script!.waiting!.options.map((o) => o.id)).toEqual(["hold", "shoot", "flee"]);
    // Standing and shooting fires the bows at -1 to hit (UX 86).
    t.play({ type: "script/answer", answer: "shoot" }, "p1", 2);
    const step = t.events.at(-1)!;
    const hit = step.type === "script/step" && step.events.find((e) => e.type === "dice/roll");
    expect(hit && hit.type === "dice/roll" && hit.roll.label).toMatch(/^to hit.*stand and shoot/);
    expect(t.notes().some((n) => /stands and shoots .* then holds/.test(n))).toBe(true);
  });

  it("a unit fights once a phase, and the log reads one combat as one item (UX 87, 88)", () => {
    const { t, spears, warband } = setup();
    toPhase(t, "combat");
    t.play({ type: "script/start", procedure: "combat", args: { unit: spears, target: warband } }, "p1", 3);
    if (t.s.script?.waiting)
      t.play({ type: "script/answer", answer: "restrain" }, t.s.script.waiting.player, 4);
    const fight = towActions.find((a) => a.id === "combat")!;
    const view = gameView(t.s, "tow-hand");
    expect(fight.available(view, { unitId: spears } as never)).toMatch(/^Fought this phase/);
    expect(fight.available(view, { unitId: warband } as never)).toMatch(/^Fought this phase/);
    const record = {
      initial: createInitialState(),
      events: [] as { seq: number; by: string; at: number; event: GameEvent }[],
    };
    // Rebuild a record from the table's events, as the host logs them.
    let state = createInitialState();
    t.events.forEach((event, i) => {
      record.events.push({ seq: i + 1, by: "p1", at: 0, event });
      state = applyEvent(state, event);
    });
    const log = buildLog(record as never);
    const item = log.find((l) => l.kind === "line" && l.text === "Marchwarden Spears fights Reaver Warband");
    expect(item && item.kind === "line" && item.detail?.length).toBeGreaterThan(3);
    const lines = item && item.kind === "line" ? item.detail!.join("\n") : "";
    expect(lines).toMatch(/to hit (\(\d+ supporting\) )?\d\+: \d+ of \d+/);
    expect(lines).not.toMatch(/to choose|= true|updated/);
  });

  it("Panic: pass on Leadership or less; else fall back (over half left) or flee", () => {
    const spears = unitNamed(setup().t.s, "Marchwarden Spears").id;
    for (let seed = 1; seed < 40; seed++) {
      const { t: fresh } = setup();
      fresh.play(
        { type: "script/start", force: true, procedure: "panic", args: { unit: spears } },
        "p1",
        seed,
      );
      // The Battle Standard Bearer in the unit re-rolls a failed test once: the last roll decides.
      const rolls = fresh.events.flatMap((ev) =>
        ev.type === "script/step"
          ? ev.events.filter((e) => e.type === "dice/roll" && /panic/i.test(JSON.stringify(e)))
          : [],
      );
      const roll = rolls.at(-1);
      const total = roll && roll.type === "dice/roll" ? roll.roll.results.reduce((a, b) => a + b, 0) : 0;
      // Best Leadership in the unit: the Warden Captain's 9. All 25 models stand, so a fail falls back.
      const text = fresh.notes().join(" ");
      expect(/keeps its nerve/.test(text)).toBe(total <= 9);
      expect(/falls back in good order/.test(text)).toBe(total > 9);
      expect(fresh.s.units[spears]!.status?.fleeing).toBeFalsy();
    }
  });

  it("Panic is offered only when there's a cause, in shooting or combat, once a phase", () => {
    const { t, spears } = setup();
    const panic = towActions.find((a) => a.id === "panic")!;
    const offered = () => panic.available(gameView(t.s, "tow-hand"), { player: "p1", unitId: spears });
    toPhase(t, "movement");
    expect(offered()).toBe("Only after shooting or combat");
    toPhase(t, "combat");
    expect(offered()).toMatch(/Nothing to panic about/);
    // A quarter of the unit lost (7 of 25).
    const ids = t.s.units[spears]!.modelIds;
    for (const id of ids.slice(-6))
      t.play({ type: "model/wounds", id, woundsLost: 1, destroyed: true }, "p1");
    expect(offered()).toMatch(/Nothing to panic about/);
    t.play({ type: "model/wounds", id: ids.at(-7)!, woundsLost: 1, destroyed: true }, "p1");
    expect(offered()).toBe(true);
    t.play({ type: "script/start", force: true, procedure: "panic", args: { unit: spears } }, "p1");
    if (!t.s.units[spears]!.status?.fleeing) expect(offered()).toBe("Already tested this phase");
  });

  it("pursuit is rolled in the procedure: catching a fleeing unit destroys it", () => {
    let seen = 0;
    for (let seed = 1; seed < 80 && seen < 2; seed++) {
      const { t, spears, warband } = setup();
      toPhase(t, "combat");
      t.play(
        { type: "script/start", procedure: "combat", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      const q = t.s.script?.waiting;
      if (!q || !/broken and flees/.test(q.question)) continue;
      seen++;
      const loser = /^Marchwarden/.test(q.question) ? spears : warband;
      t.play({ type: "script/answer", answer: "go" }, q.player, seed);
      const text = t.notes().join(" ");
      const caught = /catches .* which is destroyed/.test(text);
      expect(caught || /falls ([\d.]+"|just) short/.test(text)).toBe(true);
      expect(standing(t.s, loser) === 0).toBe(caught);
    }
    expect(seen).toBeGreaterThan(0);
  });

  /** Move a whole unit by (dx, dy). */
  const shift = (t: ReturnType<typeof setup>["t"], id: string, dx: number, dy: number) => {
    const moves = t.s.units[id]!.modelIds.map((m) => {
      const p = t.s.models[m]!.position;
      return { id: m, to: { x: p.x + dx, y: p.y + dy } };
    });
    t.s = applyEvent(t.s, { type: "models/move", moves });
    t.states.set(t.s.seq, t.s);
  };
  /** Play a script to the end, taking the first option of every question. */
  const finish = (t: ReturnType<typeof setup>["t"], seed: number) => {
    for (let i = 0; i < 20 && t.s.script?.waiting; i++) {
      const q = t.s.script.waiting;
      t.play({ type: "script/answer", answer: q.options[0]!.id }, q.player, seed + i);
    }
  };

  it("brings every unit in contact into one fight, side against side (#40)", () => {
    const { t, spears, warband } = setup();
    const brutes = unitNamed(t.s, "Tusk Brutes").id;
    // The Brutes line up beside the Warband, their front against the Spears' front too.
    block(t, brutes, 0.8, 3, Math.PI);
    shift(t, brutes, 4.4, 0);
    block(t, spears, 0, 8, 0);
    toPhase(t, "combat");
    t.play({ type: "script/start", procedure: "combat", args: { unit: spears, target: warband } }, "p1", 5);
    finish(t, 5);
    const notes = t.notes();
    expect(notes).toContain("Marchwarden Spears fights Reaver Warband and Tusk Brutes");
    expect(
      notes.some(
        (n) =>
          n.startsWith("Combat result: Marchwarden Spears ") && /Reaver Warband and Tusk Brutes \d+/.test(n),
      ),
    ).toBe(true);
    // Everyone in it has fought this phase.
    const fight = towActions.find((a) => a.id === "combat")!;
    expect(fight.available(gameView(t.s, "tow-hand"), { player: "p2", unitId: brutes })).toMatch(
      /^Fought this phase/,
    );
  });

  it("challenges: the two models fight each other, wounds and overkill count (#40)", () => {
    let fell = 0;
    for (let seed = 1; seed < 30; seed++) {
      const { t, spears, warband } = setup();
      toPhase(t, "combat");
      const view = () => gameView(t.s, "tow-hand");
      const act = towActions.find((a) => a.id === "challenge")!;
      expect(act.available(view(), { player: "p1", unitId: spears })).toBe(true);
      t.play(
        { type: "script/start", procedure: "challenge", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      // The Spears pick the Warden Captain; the Warband accepts with its Chief.
      let q = t.s.script!.waiting!;
      const captain = q.options.find((o) => o.label === "Warden Captain")!;
      t.play({ type: "script/answer", answer: captain.id }, q.player, seed);
      q = t.s.script!.waiting!;
      expect(q.options.at(-1)!.id).toBe("refuse");
      const chief = q.options.find((o) => o.label === "Accept with Reaver Chief")!;
      t.play({ type: "script/answer", answer: chief.id }, q.player, seed);
      expect(act.available(view(), { player: "p1", unitId: spears })).toBe("Already fighting a challenge");
      t.play(
        { type: "script/start", procedure: "combat", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      finish(t, seed);
      const notes = t.notes().join("\n");
      expect(notes).toMatch(
        /Challenge: Warden Captain \(Marchwarden Spears\) fights Reaver Chief \(Reaver Warband\)/,
      );
      expect(
        t.events.some(
          (e) =>
            e.type === "script/step" &&
            e.events.some((x) => x.type === "dice/roll" && x.roll.label === "Warden Captain: to hit"),
        ),
      ).toBe(true);
      const m = /(\w[\w ]+) falls in the challenge(?: \(overkill \+(\d)\))?/.exec(notes);
      if (m) {
        fell++;
        const model = Object.values(t.s.models).find((x) => x.profile?.name === m[1]);
        expect(model?.destroyed).toBe(true);
        // The challenge is over.
        expect(act.available(view(), { player: "p1", unitId: spears })).not.toBe(
          "Already fighting a challenge",
        );
      }
    }
    expect(fell).toBeGreaterThan(0);
  });

  it("a refused challenge sends a character to stand aside (#40)", () => {
    const { t, spears, warband } = setup();
    toPhase(t, "combat");
    t.play({ type: "script/start", procedure: "challenge", args: { unit: spears, target: warband } }, "p1");
    t.play({ type: "script/answer", answer: t.s.script!.waiting!.options[0]!.id }, "p1");
    t.play({ type: "script/answer", answer: "refuse" }, "p2");
    expect(t.notes().at(-1)).toMatch(/^Reaver Warband refuses the challenge: Reaver Chief stands aside/);
  });

  it("Panic tests come by themselves when a friend nearby breaks (#40)", () => {
    let seen = 0;
    for (let seed = 1; seed < 60 && !seen; seed++) {
      const { t, spears, warband } = setup();
      const slingers = unitNamed(t.s, "Reaver Slingers").id;
      // The Slingers wait 3" behind the Warband's flank.
      block(t, slingers, 8, 5, Math.PI);
      shift(t, slingers, 8, 0);
      toPhase(t, "combat");
      t.play(
        { type: "script/start", procedure: "combat", args: { unit: spears, target: warband } },
        "p1",
        seed,
      );
      finish(t, seed);
      const notes = t.notes();
      const broke = notes.some((n) => /^Reaver Warband breaks/.test(n));
      const panicked = notes.some((n) => /^Reaver Slingers sees Reaver Warband.*Panic test$/.test(n));
      if (broke) {
        expect(panicked).toBe(true);
        seen++;
      } else expect(panicked && !notes.some((n) => /destroyed|run down/.test(n))).toBe(false);
    }
    expect(seen).toBe(1);
  });
});

describe("Panic from shooting (#40)", () => {
  it("a unit that loses a quarter of its models to shooting tests once the shooting is closed", () => {
    let seen = 0;
    for (let seed = 1; seed < 40 && !seen; seed++) {
      const { t } = setup();
      const bows = unitNamed(t.s, "Fen Bowmen").id;
      const slingers = unitNamed(t.s, "Reaver Slingers").id;
      block(t, bows, -20, 5, 0);
      block(t, slingers, -12, 5, Math.PI);
      // The sample deploys the Wolf Runners where the bows now stand: out of the way (a unit in combat can't shoot).
      block(t, unitNamed(t.s, "Wolf Runners").id, 20, 5, Math.PI);
      toPhase(t, "shooting");
      t.play(
        { type: "action/take", unitId: bows, action: "shoot", weapon: "missile", targetId: slingers },
        "p1",
        seed,
      );
      for (let i = 0; i < 12 && t.s.procedure && !t.s.procedure.run.done; i++)
        t.play({ type: "procedure/roll" }, "p1", seed * 100 + i);
      const lost = 10 - standing(t.s, slingers);
      t.play({ type: "procedure/clear" }, "p1", seed);
      const notes = t.notes();
      const tested = notes.some((n) => n === `Reaver Slingers lost ${lost} of 10 models: a Panic test`);
      expect(tested).toBe(lost >= 3 && lost < 10);
      if (tested) seen++;
    }
    expect(seen).toBe(1);
  });
});

describe("March test (#40)", () => {
  it("needs an enemy within 8\", sets the result until the unit's next turn; Drilled units don't test", () => {
    const { t, spears } = setup();
    const act = towActions.find((a) => a.id === "marchTest")!;
    const offered = (id: string) => act.available(gameView(t.s, "tow-hand"), { player: "p1", unitId: id });
    // The sample spears are Drilled; these ones aren't.
    const sp = t.s.units[spears]!;
    t.s = { ...t.s, units: { ...t.s.units, [spears]: { ...sp, sheet: { ...sp.sheet!, abilities: [] } } } };
    t.states.set(t.s.seq, t.s);
    toPhase(t, "movement");
    expect(offered(spears)).toBe(true);
    t.play({ type: "script/start", procedure: "marchTest", args: { unit: spears } }, "p1", 4);
    const status = t.s.units[spears]!.status!;
    expect(status.marching).toBe(true);
    expect([0, 1]).toContain(status.marchTest);
    expect(t.notes().at(-1)).toMatch(status.marchTest === 1 ? /may march/ : /fails its march test/);
    expect(offered(spears)).toBe("Already tested this turn");
    // Far from the enemy there's nothing to test; Drilled units never test.
    for (const u of Object.values(t.s.units)) if (u.owner === "p2") block(t, u.id, 30, 6, Math.PI);
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    block(t, bows, -20, 5, 0);
    expect(offered(bows)).toMatch(/No enemy within 8"/);
    const u = t.s.units[bows]!;
    t.s = {
      ...t.s,
      units: {
        ...t.s.units,
        [bows]: { ...u, sheet: { ...u.sheet!, abilities: [{ name: "Drilled", text: "" }] } },
      },
    };
    t.states.set(t.s.seq, t.s);
    expect(offered(bows)).toMatch(/^Drilled/);
    // A charge, a march and its test last the unit's own turn.
    t.play({ type: "unit/status", id: spears, key: "charged", value: true }, "p1");
    for (let i = 0; i < 20 && t.s.turn.activeSeat === 0; i++) t.play({ type: "turn/next" }, "p1");
    for (let i = 0; i < 20 && t.s.turn.activeSeat !== 0; i++) t.play({ type: "turn/next" }, "p1");
    expect(t.s.units[spears]!.status?.charged).toBeUndefined();
    expect(t.s.units[spears]!.status?.marchTest).toBeUndefined();
  });
});
