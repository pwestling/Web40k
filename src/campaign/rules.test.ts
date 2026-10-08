import { describe, expect, it } from "vitest";
import "../systems/index";
import { DEFAULT_SYSTEM, type Intent } from "../core";
import { hookProcedures, registerCode, registerHooks, unregisterHooks } from "../core/script";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import { seededRng } from "../sandbox/protocol";
import { spawnIntents } from "../systems/wh40k/deploy";
import { sampleRoster } from "../systems/wh40k/sample";
import { battleOver } from "../ui/StatsScreen";
// @ts-expect-error: plain JavaScript example, no types.
import battleScars from "../../examples/packages/battle-scars.js";
import { campaignHash, newCampaign, recordGame } from "./book";
import { afterGameDone, awardsIn, nextCampaignHook } from "./rules";

describe("campaign rules (24b)", () => {
  it("run before and after a campaign game, and their awards go in the book", () => {
    const { procedures, table } = hookProcedures("scars", battleScars.hooks);
    registerCode(DEFAULT_SYSTEM, procedures);
    registerHooks(DEFAULT_SYSTEM, "scars", table);
    try {
      const book = newCampaign("Crusade", "c1");
      const host = new Session({
        transport: createLoopbackNetwork().connect("h"),
        role: "host",
        onChange: () => {},
        rng: seededRng(5),
        now: () => 1,
      });
      const send = (i: Intent, as: string) => host.dispatch(i, as);
      send({ type: "player/join", player: { id: "p1", name: "Ana", color: "#3b82f6", seat: 0 } }, "p1");
      send({ type: "player/join", player: { id: "p2", name: "Bo", color: "#f97316", seat: 1 } }, "p2");
      for (const i of spawnIntents(host.current, "p1", sampleRoster(0).units, "p1-a", "Vanguard"))
        send(i, "p1");
      for (const i of spawnIntents(host.current, "p2", sampleRoster(1).units, "p2-b", "Them")) send(i, "p2");
      send({ type: "campaign/set", ref: { id: "c1", name: "Crusade", hash: campaignHash(book) } }, "p1");
      send({ type: "campaign/army", player: "p1", armyId: "army-1", prefix: "p1-a", name: "Vanguard" }, "p1");

      // Before the battle: the hook is next, and once run it isn't again.
      send({ type: "turn/next" }, "p1");
      const before = nextCampaignHook("beforeGame", book, host.log, host.current);
      expect(before).toMatchObject({ type: "script/start" });
      send(before!, "p1");
      expect(nextCampaignHook("beforeGame", book, host.log, host.current)).toBeNull();

      // One of Ana's units is wiped out; the battle ends.
      for (const m of host.current.units["p1-a-0"]!.modelIds)
        send({ type: "model/wounds", id: m, woundsLost: 1, destroyed: true }, "p2");
      for (let i = 0; i < 60 && !battleOver(host.current); i++) send({ type: "turn/next" }, "p1");
      expect(afterGameDone(host.log, host.current)).toBe(false);
      const after = nextCampaignHook("afterGame", book, host.log, host.current);
      expect(
        (after as unknown as { args: { units: { survived: boolean }[] } }).args.units.some(
          (u) => !u.survived,
        ),
      ).toBe(true);
      send(after!, "p1");
      expect(afterGameDone(host.log, host.current)).toBe(true);

      const awards = awardsIn(host.log);
      expect(awards.filter((a) => a.xp).length).toBeGreaterThan(0);
      const recorded = recordGame(book, host.log, host.current, { seats: [0, 1], vp: [0, 0] });
      const survivor = recorded.units["army-1:1"]!;
      expect(survivor.xp).toBe(1);
      const lost = recorded.units["army-1:0"]!;
      expect(lost.xp ?? 0).toBe(0);
      // Its scar (if the die gave one) is in the book as awarded.
      expect(lost.scars).toBe(awards.find((a) => a.key === "army-1:0" && a.scar)?.scar ?? "");
      host.leave();
    } finally {
      unregisterHooks("scars");
    }
  });
});
