import { describe, expect, it } from "vitest";
import "../systems";
import { playMatch } from "./match";
import { botPolicy, type Level } from "./player";
import { gameModule } from "../systems";
import { gameView } from "../core/script";
import { legal, waitingOn, type BotMove } from "../soak/bot";
import { seededRng } from "../sandbox/protocol";
import type { GameState, Intent } from "../core";
import type { Policy } from "./policy";

/**
 * PX's newcomer plan (Rift Lanterns): each go, the first unit not yet used
 * walks at the nearest lantern, then fights or shoots whatever it can.
 */
function naive(seat: number, seed: number): Policy {
  const ctx = { rng: seededRng(seed), kept: new Map(), idle: 0, tidy: true, weighing: true };
  let acted = "";
  return {
    name: "naive",
    move(record, state, me) {
      const ok = (m: BotMove) => legal(record, state, m);
      const as = (intent: Intent): BotMove => ({ intent, as: me.player, kind: "naive" });
      if (state.turn.round === 0) return ok(as({ type: "turn/next" })) ? as({ type: "turn/next" }) : null;
      const waiting = waitingOn(record, state, ctx);
      if (waiting) return waiting.moves.find((m) => m.as === me.player && ok(m)) ?? null;
      if (state.turn.activeSeat !== seat) return null;
      const units = Object.values(state.units).filter(
        (u) => u.owner === me.player && u.modelIds.some((id) => !state.models[id]?.destroyed),
      );
      const acting = units.find((u) => u.status?.acting);
      const fresh = acting ?? units.find((u) => !u.status?.activated);
      if (!fresh) return as({ type: "turn/pass" });
      const key = `${state.turn.round}:${fresh.id}`;
      if (!acting) {
        acted = key;
        const ms = fresh.modelIds.map((id) => state.models[id]!).filter((m) => !m.destroyed);
        const c = {
          x: ms.reduce((a, m) => a + m.position.x, 0) / ms.length,
          y: ms.reduce((a, m) => a + m.position.y, 0) / ms.length,
        };
        const lan = [...state.objectives].sort(
          (a, b) =>
            Math.hypot(a.position.x - c.x, a.position.y - c.y) -
            Math.hypot(b.position.x - c.x, b.position.y - c.y),
        )[0]!.position;
        const M = Number.parseFloat(ms[0]!.profile?.chars.M ?? "5");
        const d = Math.hypot(lan.x - c.x, lan.y - c.y);
        const step = Math.min(M - 0.5, Math.max(0, d - 1.5));
        const k = d > 0 ? step / d : 0;
        return as({
          type: "models/move",
          moves: ms.map((m) => ({
            id: m.id,
            to: { x: m.position.x + (lan.x - c.x) * k, y: m.position.y + (lan.y - c.y) * k },
          })),
        } as Intent);
      }
      if (acted === key) {
        acted = `${key}:done`;
        const mod = gameModule(state.system)!;
        const view = gameView(state, mod.system.id);
        const actor = { player: me.player, unitId: fresh.id };
        for (const id of ["fight", "shoot"]) {
          const a = mod.actions?.find((x) => x.id === id);
          if (!a || a.available(view, actor) !== true) continue;
          const target = a.targets?.(view, actor)[0]?.unitId;
          const m = as({
            type: "script/start",
            procedure: id,
            args: { unit: fresh.id, ...(target ? { target } : {}) },
          });
          if (ok(m)) return m;
        }
      }
      return as({ type: "turn/endActivation" });
    },
  };
}

const policy = (level: string, start: GameState, seat: number, opts: { seed: number }) =>
  level === "naive" ? naive(seat, opts.seed) : botPolicy(level as Level, start, seat, opts);
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import brinewatch from "../../games/brinewatch/brinewatch.js?raw";
import { readManifest } from "../packages/manifest";

/** Package games by name: their source, played through the sandbox engine. */
const PACKAGES: Record<string, string> = { "rift-lanterns": riftLanterns, brinewatch };

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
        // BOT_MIRROR=1: both sides field the same army (alternating which), and who goes first alternates too.
        const mirror = env.BOT_MIRROR ? { mirror: ((seed >> 1) % 2) as 0 | 1, first: (seed >> 2) % 2 } : {};
        const r = await playMatch({ ...gameOf(system), seed, ...mirror }, (start) => [
          policy(flip ? b : a, start, 0, { seed: seed * 31, ...tune(flip ? "b" : "a") }),
          policy(flip ? a : b, start, 1, { seed: seed * 37, ...tune(flip ? "a" : "b") }),
        ]);
        const aSeat = flip ? 1 : 0;
        if (r.winner === null) wins[2]!++;
        else wins[r.winner === aSeat ? 0 : 1]!++;
        console.log(
          `${system} seed ${seed} ${flip ? `${b} v ${a}` : `${a} v ${b}`}: winner ${r.winner} vp ${r.vp} kept ${r.kept.map((k) => k.toFixed(2))} r${r.rounds} steps ${r.steps} think ${r.thinking.map((t) => Math.round(t))}ms/${r.decisions} max ${r.slowest.map((t) => Math.round(t))}ms ${r.error ?? ""}`,
        );
        expect(r.error).toBeUndefined();
      }
      console.log(`${system} ${a} ${wins[0]} – ${b} ${wins[1]} (draws ${wins[2]})`);
    }, 3_600_000);
});
