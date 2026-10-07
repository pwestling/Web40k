import { describe, expect, it } from "vitest";
import { commitmentOf, revealMatches, sha256Hex, stableJson } from "./secrets";

describe("secrets", () => {
  it("hashes with SHA-256", async () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const text of ["x".repeat(55), "y".repeat(56), "z".repeat(64), "Ünïcødé ⚔ ".repeat(300)]) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      expect(sha256Hex(text)).toBe(hex);
    }
  });

  it("commits to a value regardless of key order, and checks reveals", () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    const commitment = commitmentOf({ objective: "hold", n: 2 }, "s1");
    expect(commitmentOf({ n: 2, objective: "hold" }, "s1")).toBe(commitment);
    expect(revealMatches({ commitment }, { n: 2, objective: "hold" }, "s1")).toBe(true);
    expect(revealMatches({ commitment }, { n: 3, objective: "hold" }, "s1")).toBe(false);
    expect(revealMatches({ commitment }, { n: 2, objective: "hold" }, "s2")).toBe(false);
    expect(revealMatches({ commitment, revealed: { value: 1 } }, { n: 2, objective: "hold" }, "s1")).toBe(
      false,
    );
  });
});
