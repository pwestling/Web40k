import { describe, expect, it } from "vitest";
import "../systems";
import { playMatch } from "./match";
import { botPolicy, type Level } from "./player";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import { readManifest } from "../packages/manifest";

/** Package games by name: their source, played through the sandbox engine. */
const PACKAGES: Record<string, string> = { "rift-lanterns": riftLanterns };

function gameOf(name: string): { system: string; systemPkg?: { source: string } } {
  const source = PACKAGES[name];
  if (!source) return { system: name };
  const read = readManifest(source);
  if ("error" in read) throw new Error(read.error);
  return { system: read.manifest.systems[0]!, systemPkg: { source } };
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** BOT_A / BOT_B: JSON options for either side ({"weights": {...}, "tries": n}), for tuning. */
const tune = (side: "a" | "b") => {
  const raw = env[side === "a" ? "BOT_A" : "BOT_B"];
  return raw ? (JSON.parse(raw) as object) : {};
};

describe("bot matches", () => {
  const systems = (env.BOT_SYSTEMS ?? "forty-k-11").split(",");
  const [a, b] = (env.BOT_PAIR ?? "steady,random").split(",") as [Level, Level];
  const n = Number(env.BOT_SEEDS ?? 4);
  const from = Number(env.BOT_FROM ?? 1);
  for (const system of systems)
    it(`${system}: ${a} vs ${b}`, async () => {
      const wins = [0, 0, 0];
      for (let seed = from; seed < from + n; seed++) {
        // Each bot plays both seats, half the games each.
        const flip = seed % 2 === 0;
        const r = await playMatch({ ...gameOf(system), seed }, (start) => [
          botPolicy(flip ? b : a, start, 0, { seed: seed * 31, ...tune(flip ? "b" : "a") }),
          botPolicy(flip ? a : b, start, 1, { seed: seed * 37, ...tune(flip ? "a" : "b") }),
        ]);
        const aSeat = flip ? 1 : 0;
        if (r.winner === null) wins[2]!++;
        else wins[r.winner === aSeat ? 0 : 1]!++;
        console.log(
          `${system} seed ${seed} ${flip ? `${b} v ${a}` : `${a} v ${b}`}: winner ${r.winner} vp ${r.vp} kept ${r.kept.map((k) => k.toFixed(2))} r${r.rounds} steps ${r.steps} think ${r.thinking.map((t) => Math.round(t))}ms/${r.decisions} ${r.error ?? ""}`,
        );
        expect(r.error).toBeUndefined();
      }
      console.log(`${system} ${a} ${wins[0]} – ${b} ${wins[1]} (draws ${wins[2]})`);
    }, 3_600_000);
});
