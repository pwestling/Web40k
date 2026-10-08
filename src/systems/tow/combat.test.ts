import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  resolveIntent,
  type GameEvent,
  type GameState,
  type Intent,
  type PlayerId,
} from "../../core";
import { buildLog } from "../../ui/gameLog";
import "../index";
import { spawnIntents } from "../wh40k/deploy";
import { gameView } from "../../core/script";
import { combatHit, toWound, towActions } from "./combat";
import { towSample } from "./sample";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny host: keeps every state by seq so code procedures can replay. */
class Table {
  states = new Map<number, GameState>();
  events: GameEvent[] = [];
  constructor(public s: GameState) {
    this.states.set(s.seq, s);
  }
  play(intent: Intent, from: PlayerId, seed = 1): GameEvent {
    const event = resolveIntent(intent, from, rng(seed), this.s, (seq) => this.states.get(seq)!);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    this.s = applyEvent({ ...this.s, seq: this.s.seq + 1 }, event);
    this.states.set(this.s.seq, this.s);
    this.events.push(event);
    return event;
  }
  notes(): string[] {
    return this.events.flatMap((e) =>
      e.type === "script/step" ? e.events.flatMap((x) => (x.type === "log/note" ? [x.text] : [])) : [],
    );
  }
}

const unitNamed = (s: GameState, name: string) => Object.values(s.units).find((u) => u.name === name)!;

/** Line a unit up in ranks of `files`, front rank on y, facing +y (0) or -y (PI). */
function block(t: Table, unitId: string, y: number, files: number, facing: number) {
  const unit = t.s.units[unitId]!;
  const dir = facing === 0 ? -1 : 1;
  const moves = unit.modelIds.map((id, i) => ({
    id,
    to: { x: ((i % files) - (files - 1) / 2) * 0.8, y: y + dir * Math.floor(i / files) * 0.8 },
    facing,
  }));
  const moved = applyEvent(
    { ...t.s, units: { ...t.s.units, [unitId]: { ...unit, formation: { kind: "ranked", files } } } },
    { type: "models/move", moves },
  );
  // models/move keeps facings; turn the block too.
  const models = { ...moved.models };
  for (const id of unit.modelIds) models[id] = { ...models[id]!, facing };
  t.s = { ...moved, models };
  t.states.set(t.s.seq, t.s);
}

function setup(): { t: Table; spears: string; warband: string } {
  const t = new Table(createInitialState());
  t.play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  t.play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  t.play({ type: "game/system", system: "tow-hand" }, "p1");
  t.play({ type: "layout/set", layout: { terrain: [], objectives: [], zones: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(t.s, p, towSample(seat).units, p, "army")) t.play(i, p);
  const spears = unitNamed(t.s, "Marchwarden Spears").id;
  const warband = unitNamed(t.s, "Reaver Warband").id;
  // Front ranks touching.
  block(t, spears, 0, 5, 0);
  block(t, warband, 0.8, 6, Math.PI);
  return { t, spears, warband };
}

function toPhase(t: Table, id: string) {
  for (let i = 0; i < 20; i++) {
    if (t.s.turn.round > 0 && currentSlot(t.s)?.id === id && t.s.turn.activeSeat === 0) return;
    t.play({ type: "turn/next" }, "p1");
  }
  throw new Error(`no ${id} phase`);
}

const standing = (s: GameState, unitId: string) =>
  s.units[unitId]!.modelIds.filter((id) => !s.models[id]!.destroyed).length;

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
    const item = log.find((l) => l.kind === "line" && l.text === "Marchwarden Spears fight Reaver Warband");
    expect(item && item.kind === "line" && item.detail?.length).toBeGreaterThan(3);
    const lines = item && item.kind === "line" ? item.detail!.join("\n") : "";
    expect(lines).toMatch(/to hit \d\+: \d+ of \d+/);
    expect(lines).not.toMatch(/to choose|= true|updated/);
  });

  it("Panic: pass on Leadership or less; else fall back (over half left) or flee", () => {
    const spears = unitNamed(setup().t.s, "Marchwarden Spears").id;
    for (let seed = 1; seed < 40; seed++) {
      const { t: fresh } = setup();
      fresh.play({ type: "script/start", procedure: "panic", args: { unit: spears } }, "p1", seed);
      const step = fresh.events.at(-1)!;
      const roll = step.type === "script/step" && step.events.find((e) => e.type === "dice/roll");
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
    const lost = t.s.units[spears]!.modelIds.at(-1)!;
    t.play({ type: "model/wounds", id: lost, woundsLost: 1, destroyed: true }, "p1");
    expect(offered()).toBe(true);
    t.play({ type: "script/start", procedure: "panic", args: { unit: spears } }, "p1");
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
      expect(caught || /falls [\d.]+" short/.test(text)).toBe(true);
      expect(standing(t.s, loser) === 0).toBe(caught);
    }
    expect(seen).toBeGreaterThan(0);
  });
});
