import { describe, expect, it } from "vitest";
import { createInitialState, type LoggedEvent } from "../../core";
import { buildLog } from "../../ui/gameLog";
import { gameView } from "../../core/script";
import { blockSlots } from "../../core/regiment";
import { characterActions } from "./characters";
import { block, setup, toPhase, unitNamed } from "./testing";

describe("Old World characters join and leave regiments (#40)", () => {
  it("joins the front rank, and leaves again as it was", () => {
    const { t, spears } = setup();
    const marshal = unitNamed(t.s, "Fen Marshal").id;
    const model = t.s.units[marshal]!.modelIds[0]!;
    toPhase(t, "movement");
    const join = characterActions.find((a) => a.id === "joinRegiment")!;
    const view = () => gameView(t.s, "tow-hand");
    // Far away: nothing to join.
    block(t, marshal, -30, 1, 0);
    expect(join.available(view(), { player: "p1", unitId: marshal })).toMatch(/No friendly regiment/);
    // Just behind the spears.
    block(t, marshal, -5, 1, 0);
    expect(join.available(view(), { player: "p1", unitId: marshal })).toBe(true);
    expect(join.targets!(view(), { player: "p1", unitId: marshal }).map((x) => x.unitId)).toContain(spears);
    t.play(
      { type: "script/start", procedure: "joinRegiment", args: { unit: marshal, target: spears } },
      "p1",
    );
    expect(t.s.units[marshal]).toBeUndefined();
    const joined = t.s.units[spears]!;
    expect(joined.name).toBe("Marchwarden Spears + Fen Marshal");
    expect(t.s.models[model]!.unitId).toBe(spears);
    // In the front rank.
    expect(blockSlots(t.s, joined).indexOf(model)).toBeLessThan(5);
    expect(joined.sheet!.keywords).toContain("Character");

    const leave = characterActions.find((a) => a.id === "leaveRegiment")!;
    expect(leave.targets!(view(), { player: "p1", unitId: spears })).toEqual([
      { unitId: marshal, label: "Fen Marshal" },
    ]);
    t.play(
      { type: "script/start", procedure: "leaveRegiment", args: { unit: spears, target: marshal } },
      "p1",
    );
    const back = t.s.units[marshal]!;
    expect(back.modelIds).toEqual([model]);
    expect(t.s.models[model]!.unitId).toBe(marshal);
    const spearsAfter = t.s.units[spears]!;
    expect(spearsAfter.name).toBe("Marchwarden Spears");
    expect(spearsAfter.modelIds).not.toContain(model);
    expect(spearsAfter.joined).toBeUndefined();
    expect(spearsAfter.status?.attached).toBeUndefined();
    expect(spearsAfter.sheet!.keywords).not.toContain("Character");
    expect(t.notes().at(-1)).toBe("Fen Marshal left Marchwarden Spears");

    // The log says each in one line, without the reshuffles behind it (UX 321).
    const record = { initial: createInitialState(), events: [] as LoggedEvent[] };
    t.events.forEach((event, i) => record.events.push({ seq: i + 1, by: "p1", at: 0, event }));
    const texts = buildLog(record as never).flatMap((l) =>
      l.kind === "line" ? [l.text, ...(l.detail ?? [])] : [],
    );
    expect(texts).toContain("Fen Marshal joined Marchwarden Spears");
    expect(texts).toContain("Fen Marshal left Marchwarden Spears");
    expect(texts.join("\n")).not.toMatch(/attached a unit|reformed|moved a model/);
  });
});
