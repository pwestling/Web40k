import { afterEach, describe, expect, it } from "vitest";
import { netConfig, setSiteConfig } from "./config";

describe("netConfig", () => {
  afterEach(() => setSiteConfig({}, false));

  it("uses the site's config.json when the URL says nothing", () => {
    const turn = [{ urls: ["turn:battle.example:3478"], username: "1:x", credential: "c" }];
    setSiteConfig({ signal: ["wss://battle.example/relay"], turn });
    expect(netConfig("")).toEqual({
      signal: ["wss://battle.example/relay"],
      nostr: [],
      turn,
      openTables: false,
    });
  });

  it("lets the page URL win over the site", () => {
    setSiteConfig({ signal: ["wss://battle.example/relay"] });
    const config = netConfig("?signal=ws://localhost:8787&turn=turn:other:3478&turnUser=u&turnPass=p");
    expect(config.signal).toEqual(["ws://localhost:8787"]);
    expect(config.turn).toEqual([{ urls: ["turn:other:3478"], username: "u", credential: "p" }]);
  });

  it("has Open tables on the public relays, and off on a self-hosted site unless it says so (#50)", () => {
    expect(netConfig("").openTables).toBe(true);
    expect(netConfig("").board).toBeUndefined();
    expect(netConfig("?openTables=0").openTables).toBe(false);
    // A private relay: nothing goes to the public board.
    expect(netConfig("?signal=ws://localhost:8787").openTables).toBe(false);
    setSiteConfig({ signal: ["wss://battle.example/relay"] });
    expect(netConfig("").openTables).toBe(false);
    setSiteConfig({
      signal: ["wss://battle.example/relay"],
      openTables: true,
      board: "https://battle.example/relay/board",
    });
    expect(netConfig("")).toMatchObject({ openTables: true, board: "https://battle.example/relay/board" });
  });
});
