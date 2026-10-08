import { afterEach, describe, expect, it } from "vitest";
import { netConfig, setSiteConfig } from "./config";

describe("netConfig", () => {
  afterEach(() => setSiteConfig({}));

  it("uses the site's config.json when the URL says nothing", () => {
    const turn = [{ urls: ["turn:battle.example:3478"], username: "1:x", credential: "c" }];
    setSiteConfig({ signal: ["wss://battle.example/relay"], turn });
    expect(netConfig("")).toEqual({ signal: ["wss://battle.example/relay"], nostr: [], turn });
  });

  it("lets the page URL win over the site", () => {
    setSiteConfig({ signal: ["wss://battle.example/relay"] });
    const config = netConfig("?signal=ws://localhost:8787&turn=turn:other:3478&turnUser=u&turnPass=p");
    expect(config.signal).toEqual(["ws://localhost:8787"]);
    expect(config.turn).toEqual([{ urls: ["turn:other:3478"], username: "u", credential: "p" }]);
  });
});
