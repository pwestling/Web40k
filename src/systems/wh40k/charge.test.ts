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

describe("40k Battle-shock test", () => {
  it("is offered only below half-strength, counting a lone model's wounds", () => {
    let r: GameRecord = createRecord(createInitialState());
    const host = (i: Intent, by: string) => {
      const l = resolveLogged(r, i, by, () => 0.5, 0);
      if (!l) throw new Error(`Rejected ${i.type}`);
      r = appendEvent(r, l);
    };
    host({ type: "player/join", player: { id: "a", name: "A", color: "#00f", seat: 0 } }, "a");
    host({ type: "player/join", player: { id: "b", name: "B", color: "#f00", seat: 1 } }, "b");
    host({ type: "game/system", system: wh40kModule.system.id }, "a");
    for (const i of spawnIntents(stateAt(r), "a", wh40kModule.app!.sample(0).units, "a", "x")) host(i, "a");
    host({ type: "turn/next" }, "a");
    const s = stateAt(r);
    const units = Object.values(s.units).filter((u) => u.owner === "a");
    const lone = units.find(
      (u) => u.modelIds.length === 1 && Number(s.models[u.modelIds[0]!]!.profile?.chars.W) > 1,
    )!;
    const squad = units.find((u) => u.modelIds.length >= 4)!;
    const shock = (id: string) => unitActions(stateAt(r), id).find((o) => o.def.id === "battleShockTest")!.ok;
    expect(lone && squad).toBeTruthy();
    expect(shock(lone.id)).toBe(false);
    expect(shock(squad.id)).toBe(false);
    const w = Number(s.models[lone.modelIds[0]!]!.profile!.chars.W);
    host(
      { type: "model/wounds", id: lone.modelIds[0]!, woundsLost: Math.ceil(w / 2) - 1, destroyed: false },
      "a",
    );
    expect(shock(lone.id)).toBe(false);
    host(
      {
        type: "model/wounds",
        id: lone.modelIds[0]!,
        woundsLost: w - Math.floor((w - 1) / 2),
        destroyed: false,
      },
      "a",
    );
    expect(shock(lone.id)).toBe(true);
    const half = Math.ceil(squad.modelIds.length / 2);
    for (const id of squad.modelIds.slice(0, squad.modelIds.length - half))
      host({ type: "model/wounds", id, woundsLost: 1, destroyed: true }, "a");
    expect(shock(squad.id)).toBe(false);
    host({ type: "model/wounds", id: squad.modelIds.at(-1)!, woundsLost: 1, destroyed: true }, "a");
    expect(shock(squad.id)).toBe(true);
  });
});

describe("40k shooting after an Advance", () => {
  it("is only with Assault weapons", () => {
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
    while (currentSlot(stateAt(r))?.id !== "movement" || stateAt(r).turn.activeSeat !== 0)
      host({ type: "turn/next" }, "a");
    const mine = Object.values(stateAt(r).units).find(
      (u) => u.owner === "a" && Object.values(u.sheet?.weapons ?? {}).some((w) => w.kind === "ranged"),
    )!;
    host({ type: "action/take", unitId: mine.id, action: "advance" } as Intent, "a");
    host({ type: "turn/next" }, "a");
    const s = stateAt(r);
    const enemy = Object.values(s.units).find((u) => u.owner === "b")!;
    const [id, weapon] = Object.entries(mine.sheet!.weapons).find(([, w]) => w.kind === "ranged")!;
    const shoot = (state: typeof s) =>
      unitActions(state, mine.id, { weapon: id, targetId: enemy.id }).find((o) => o.def.id === "shoot")!;
    expect(shoot(s).why).toBe("Advanced: only Assault weapons");
    const assault = {
      ...s,
      units: {
        ...s.units,
        [mine.id]: {
          ...s.units[mine.id]!,
          sheet: {
            ...s.units[mine.id]!.sheet!,
            weapons: { ...s.units[mine.id]!.sheet!.weapons, [id]: { ...weapon, keywords: ["Assault"] } },
          },
        },
      },
    };
    expect(shoot(assault).why).not.toBe("Advanced: only Assault weapons");
  });
});
