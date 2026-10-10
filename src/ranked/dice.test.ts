import { describe, expect, it } from "vitest";
import { commitTo, type GameRecord } from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import { checkStretch } from "./dice";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const A = "a".repeat(43) + "." + "a".repeat(43);
const B = "b".repeat(43) + "." + "b".repeat(43);
const SEED = "1".repeat(64);

/** A ranked table, host and guest seated, with shared dice committed and answered, then three rolls and the reveal. */
async function play(fair: boolean): Promise<GameRecord> {
  const net = createLoopbackNetwork();
  const secrets = new Map([[commitTo(SEED), SEED]]);
  const host = new Session({
    transport: net.connect("host"),
    role: "host",
    onChange: () => {},
    // A host that cheats rolls its own dice: it "lost" the seed it committed to.
    sharedSecret: (c) => (fair ? secrets.get(c) : undefined),
  });
  const guest = new Session({ transport: net.connect("guest"), role: "client", onChange: () => {} });
  await flush();
  host.dispatch({ type: "player/join", player: { id: "host", name: "Ana", color: "#00f", seat: 0 } });
  guest.dispatch({ type: "player/join", player: { id: "guest", name: "Ben", color: "#f00", seat: 1 } });
  await flush();
  host.dispatch({ type: "ranked/card", key: A });
  guest.dispatch({ type: "ranked/card", key: B });
  await flush();
  host.dispatch({ type: "dice/commit", hash: commitTo(SEED) });
  await flush();
  // A guest can't commit for the host.
  guest.dispatch({ type: "dice/commit", hash: "2".repeat(64) });
  guest.dispatch({ type: "dice/seed", seed: "3".repeat(64) });
  await flush();
  for (let i = 0; i < 3; i++) {
    (i % 2 ? guest : host).dispatch({ type: "dice/roll", count: 10, sides: 6 } as never);
    await flush();
  }
  // Only the seed committed to is taken.
  host.dispatch({ type: "dice/reveal", seed: "4".repeat(64) });
  host.dispatch({ type: "dice/reveal", seed: SEED });
  await flush();
  return guest.log;
}

describe("shared dice (core/sharedDice.ts)", () => {
  it("rolls every event again from the revealed seeds and finds the same dice", async () => {
    const record = await play(true);
    expect(record.events.filter((e) => e.event.type === "dice/commit")).toHaveLength(1);
    expect(record.events.filter((e) => e.event.type === "dice/reveal")).toHaveLength(1);
    const reveal = record.events.find((e) => e.event.type === "dice/reveal")!;
    expect(checkStretch(record, reveal)).toMatchObject({ checked: 3, wrong: [], unchecked: 0 });
  });

  it("catches a host whose dice weren't the shared ones", async () => {
    const record = await play(false);
    const reveal = record.events.find((e) => e.event.type === "dice/reveal")!;
    expect(checkStretch(record, reveal)!.wrong).toHaveLength(3);
  });
});
