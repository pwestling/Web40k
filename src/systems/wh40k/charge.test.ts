import { describe, expect, it } from "vitest";
import "../index";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type Intent,
} from "../../core";
import { unitActions } from "../../core/content/play";
import { currentSlot } from "../../core/content/turn";
import { spawnIntents } from "./deploy";
import { wh40kModule } from "./module";

describe("40k charge", () => {
  it("is offered only with an enemy unit within 12 inches", () => {
    let r: GameRecord = createRecord(createInitialState());
    const host = (i: Intent, by: string) => {
      const l = resolveLogged(r, i, by, () => 0.5, 0);
      if (!l) throw new Error(`Rejected ${i.type}`);
      r = appendEvent(r, l);
    };
    host({ type: "player/join", player: { id: "a", name: "A", color: "#00f", seat: 0 } }, "a");
    host({ type: "player/join", player: { id: "b", name: "B", color: "#f00", seat: 1 } }, "b");
    host({ type: "game/system", system: wh40kModule.system.id }, "a");
    for (const [p, seat] of [
      ["a", 0],
      ["b", 1],
    ] as const)
      for (const i of spawnIntents(stateAt(r), p, wh40kModule.app!.sample(seat).units, p, "x")) host(i, p);
    while (currentSlot(stateAt(r))?.id !== "charge") host({ type: "turn/next" }, "a");
    const s = stateAt(r);
    const mine = Object.values(s.units).find((u) => u.owner === "a")!;
    const enemy = Object.values(s.units).find((u) => u.owner === "b")!;
    const charge = () => unitActions(stateAt(r), mine.id).find((o) => o.def.id === "charge")!;
    // Pull every enemy unit far away, then bring one within 8".
    for (const u of Object.values(s.units).filter((u) => u.owner === "b"))
      host(
        { type: "models/move", moves: u.modelIds.map((id, i) => ({ id, to: { x: -25 + i, y: -21 } })) },
        "b",
      );
    for (const id of mine.modelIds) host({ type: "models/move", moves: [{ id, to: { x: 20, y: 20 } }] }, "a");
    expect(charge().ok).toBe(false);
    expect(charge().why).toBe('No enemy within 12"');
    host(
      {
        type: "models/move",
        moves: enemy.modelIds.map((id, i) => ({
          id,
          to: { x: 20 - 1.5 * (i % 5), y: 12 - 1.5 * Math.floor(i / 5) },
        })),
      },
      "b",
    );
    expect(charge().ok).toBe(true);
  });
});
