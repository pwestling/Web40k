import { describe, expect, it } from "vitest";
import "../systems/index";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type Intent,
} from "../core";
import { currentSlot } from "../core/content/turn";
import { spawnIntents } from "../systems/wh40k/deploy";
import { wh40kModule } from "../systems/wh40k/module";
import { tableVerb } from "./tableVerbs";

/** Two sample armies, one unit of each placed at `gap` inches apart, in the given phase. */
function table(phase: string, gap: number) {
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
  while (currentSlot(stateAt(r))?.id !== phase) host({ type: "turn/next" }, "a");
  const s = stateAt(r);
  const mine = Object.values(s.units).find((u) => u.owner === "a" && u.modelIds.length >= 4)!;
  const enemy = Object.values(s.units).find((u) => u.owner === "b" && u.modelIds.length >= 4)!;
  // Everyone else well out of the way.
  for (const u of Object.values(s.units).filter((u) => u.id !== mine.id && u.id !== enemy.id))
    host(
      {
        type: "models/move",
        moves: u.modelIds.map((id, i) => ({ id, to: { x: -28 + i, y: u.owner === "a" ? 20 : -20 } })),
      },
      u.owner,
    );
  host({ type: "models/move", moves: mine.modelIds.map((id, i) => ({ id, to: { x: i * 1.5, y: 0 } })) }, "a");
  host(
    { type: "models/move", moves: enemy.modelIds.map((id, i) => ({ id, to: { x: i * 1.5, y: gap + 1.3 } })) },
    "b",
  );
  return { s: stateAt(r), mine: mine.id, enemy: enemy.id };
}

describe("acting on the table (UX 84)", () => {
  it("shoots an enemy in reach, saying which weapons reach", () => {
    const { s, mine, enemy } = table("shooting", 10);
    const v = tableVerb(s, mine, enemy)!;
    expect(v.verb).toBe("shoot");
    expect(v.ok).toBe(true);
    expect(v.facts.some((f) => /^\d+× /.test(f))).toBe(true);
  });

  it("says when nothing reaches, and acts only on an enemy", () => {
    const far = table("shooting", 40);
    const v = tableVerb(far.s, far.mine, far.enemy)!;
    expect(v.ok).toBe(false);
    expect(v.line).toMatch(/Out of range/);
    expect(tableVerb(far.s, far.mine, far.mine)).toBeNull();
  });

  it("declares a charge with the roll it needs, and nothing in other phases", () => {
    const { s, mine, enemy } = table("charge", 6);
    const v = tableVerb(s, mine, enemy)!;
    expect(v.verb).toBe("charge");
    expect(v.facts.join(" ")).toMatch(/needs \d+\+/);
    const moving = table("movement", 6);
    expect(tableVerb(moving.s, moving.mine, moving.enemy)).toBeNull();
  });
});
