import { describe, expect, it } from "vitest";
import type { PackageRef } from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import { describePackageChange } from "../ui/gameLog";
import { compareVersions, systemMatches } from "./library";

const tick = () => new Promise((r) => setTimeout(r, 20));

const ref = (version: string, hash: string): PackageRef => ({
  id: "owf",
  name: "Old World Factions",
  version,
  hash,
  bytes: 1000,
});

describe("rules packages", () => {
  it("compares versions and matches systems", () => {
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(systemMatches("tow", "tow-hand")).toBe(true);
    expect(systemMatches("wh40k", "tow")).toBe(false);
  });

  it("describes a change", () => {
    expect(describePackageChange([ref("1.2", "a")], [ref("1.3", "b")])).toBe("Old World Factions 1.2 → 1.3");
    expect(describePackageChange([], [ref("1.3", "b")])).toBe("+ Old World Factions 1.3");
    expect(describePackageChange([ref("1.2", "a")], [])).toBe("− Old World Factions 1.2");
  });

  it("changes packages mid-game only once every seated player accepts", async () => {
    const net = createLoopbackNetwork();
    const host = new Session({ transport: net.connect("h"), role: "host", onChange: () => {} });
    const client = new Session({ transport: net.connect("c"), role: "client", onChange: () => {} });
    await tick();
    host.dispatch({ type: "player/join", player: { id: "h", name: "Ann", color: "#00f", seat: 0 } });
    client.dispatch({ type: "player/join", player: { id: "c", name: "Bo", color: "#f00", seat: 1 } });
    await tick();
    const base = { app: "test", system: { id: "tow-hand", builtIn: true } };
    host.dispatch({ type: "game/packages", ...base, packages: [ref("1.2", "a")] });
    host.dispatch({ type: "packages/propose", packages: [ref("1.3", "b")] });
    await tick();
    expect(client.current.packageProposal).toMatchObject({ by: "h", accepted: ["h"], declined: [] });
    client.dispatch({ type: "packages/decline" });
    await tick();
    expect(host.current.packageProposal?.declined).toEqual(["c"]);
    host.dispatch({ type: "packages/withdraw" });
    await tick();
    expect(client.current.packageProposal).toBeUndefined();
    // Accept with no proposal open does nothing.
    client.dispatch({ type: "packages/accept" });
    await tick();
    expect(client.current.packageProposal).toBeUndefined();
    host.dispatch({ type: "packages/propose", packages: [ref("1.3", "b")] });
    await tick();
    client.dispatch({ type: "packages/accept" });
    await tick();
    expect(host.current.packageProposal?.accepted).toEqual(["h", "c"]);
    host.dispatch({ type: "game/packages", ...base, packages: [ref("1.3", "b")], agreed: ["h", "c"] });
    await tick();
    expect(client.current.packages?.packages[0]?.hash).toBe("b");
    expect(client.current.packageProposal).toBeUndefined();

    // A player who goes without a package is flagged for everyone, until the rules change.
    client.dispatch({ type: "player/rules", missing: ["b"] });
    await tick();
    expect(host.current.players.c?.rulesMismatch).toEqual(["b"]);
    host.dispatch({ type: "game/packages", ...base, packages: [ref("1.2", "a")] });
    await tick();
    expect(host.current.players.c?.rulesMismatch).toBeUndefined();
  });
});
