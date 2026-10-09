import { describe, expect, it } from "vitest";
import { createRecord, type GameState } from "../core";
import { block, setup, toPhase, unitNamed, type Table } from "../systems/tow/testing";
import { botPolicy } from "./player";
import type { BotMove } from "../soak/bot";

/**
 * The computer opponent and the Old World's universal special rules (#66):
 * it plays shots, charges and fights through the module's own rules, so a
 * rule read by name changes what it expects from them. Invented units.
 */

function decide(s: GameState, seat: number): BotMove | null {
  const player = Object.values(s.players).find((p) => p.seat === seat)!.id;
  return botPolicy("steady", s, seat, { seed: 1 }).move(createRecord(s), s, { seat, player });
}

/** Give a unit special rules by name, as a roster would. */
function rule(t: Table, unitId: string, ...names: string[]) {
  const u = t.s.units[unitId]!;
  const abilities = [...u.sheet!.abilities, ...names.map((name) => ({ name, text: "" }))];
  t.s = { ...t.s, units: { ...t.s.units, [unitId]: { ...u, sheet: { ...u.sheet!, abilities } } } };
  t.states.set(t.s.seq, t.s);
}

/** Line a unit up `files` wide with its front rank at (x, y). */
function place(t: Table, unitId: string, x: number, y: number, files: number, facing: number) {
  block(t, unitId, y, files, facing);
  const models = { ...t.s.models };
  for (const id of t.s.units[unitId]!.modelIds) {
    const m = models[id]!;
    models[id] = { ...m, position: { ...m.position, x: m.position.x + x } };
  }
  t.s = { ...t.s, models };
  t.states.set(t.s.seq, t.s);
}

const targetOf = (m: BotMove | null) =>
  m?.intent.type === "action/take" ? (m.intent as { targetId?: string }).targetId : undefined;

describe("the bot and the Old World's special rules (#66)", () => {
  it("shoots past a target whose Ward save and Regeneration (read by name) would shrug the shots off", () => {
    const table = () => {
      const { t } = setup();
      const bows = unitNamed(t.s, "Fen Bowmen").id;
      const warband = unitNamed(t.s, "Reaver Warband").id;
      const slingers = unitNamed(t.s, "Reaver Slingers").id;
      place(t, bows, 0, -8, 5, 0);
      place(t, warband, -8, 8, 6, Math.PI);
      place(t, slingers, 8, 8, 5, Math.PI);
      toPhase(t, "shooting");
      return { t, warband, slingers };
    };
    const plain = table();
    const m0 = decide(plain.t.s, 0);
    const first = targetOf(m0);
    expect(first).toBeTruthy();
    const warded = table();
    rule(warded.t, first!, "Ward save (2+)", "Regeneration (2+)");
    const second = targetOf(decide(warded.t.s, 0));
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
