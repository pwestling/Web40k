import { expect, it } from "vitest";
import "../systems";
import secondWind from "../../examples/packages/second-wind.js?raw";
import type { GameEvent, GameState } from "../core";
import { tableWarnings } from "../ui/warnings";
import { soak, type SoakOptions } from "./run";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Seeded soak games for one system: SOAK_SEEDS games (20 by default) from
 * seed SOAK_FROM (1). A failing game names its seed, so `SOAK_FROM=<seed>
 * SOAK_SEEDS=1` replays exactly that game.
 */
export function soakSuite(system: string, teamSize: 1 | 2 = 1): void {
  const count = Number(env.SOAK_SEEDS ?? 20);
  const from = Number(env.SOAK_FROM ?? 1);
  for (let seed = from; seed < from + count; seed++)
    it(
      `${system}${teamSize > 1 ? " 2v2" : ""} seed ${seed}`,
      async () => {
        const r = await soak({ system, seed, teamSize, pkg: { source: secondWind, systems: ["tow-hand"] } });
        if (!r.ok)
          console.error(
            `SOAK FAIL ${system}${teamSize > 1 ? " 2v2" : ""} seed ${seed} (replay: SOAK_FROM=${seed} SOAK_SEEDS=1): ${r.failures.join("; ")}\n  trouble: ${r.trouble.join(", ")}`,
          );
        expect(r.failures).toEqual([]);
        expect(r.finished).toBe(true);
        // A 2v2 game moves four armies, so it takes several times as long; on a loaded machine
        // seed 157 took 150s (36s on its own).
      },
      teamSize > 1 ? 400_000 : 120_000,
    );
}

/**
 * A rules-gap scenario (#40): seeded soak games with a probe, passing only
 * when every tag in `expect` turned up in some game, so a closed gap that
 * quietly stops firing fails here. Fewer seeds than the full soak by default.
 */
export function scenarioSuite(
  name: string,
  system: string,
  options: Pick<
    SoakOptions,
    "automate" | "watch" | "armies" | "closeIn" | "lineUp" | "settings" | "systemPkg" | "maxSteps"
  > & {
    /** At least this many games, whatever SOAK_SEEDS says (rules that come up less often). */
    minSeeds?: number;
  },
  tags: string[],
  /** Tags that must never come up (a rule broken again). */
  never: string[] = [],
): void {
  const count = Math.max(Number(env.SOAK_SEEDS ?? 3), options.minSeeds ?? 0);
  const from = Number(env.SOAK_FROM ?? 1);
  const seen: Record<string, number> = {};
  for (let seed = from; seed < from + count; seed++)
    it(`${name} seed ${seed}`, async () => {
      const { minSeeds: _, ...opts } = options;
      const r = await soak({ system, seed, ...opts });
      if (!r.ok)
        console.error(
          `SOAK FAIL ${name} seed ${seed} (replay: SOAK_FROM=${seed} SOAK_SEEDS=1): ${r.failures.join("; ")}`,
        );
      expect(r.failures).toEqual([]);
      expect(r.finished).toBe(true);
      for (const [k, v] of Object.entries(r.seen)) seen[k] = (seen[k] ?? 0) + v;
    }, 120_000);
  it(`${name}: came up in play`, () => {
    if (env.SOAK_SEEN) console.log(JSON.stringify(seen));
    expect(tags.filter((t) => !seen[t])).toEqual([]);
    expect(never.filter((t) => seen[t])).toEqual([]);
  });
}

type Roster = ReturnType<NonNullable<SoakOptions["armies"]>>;

type Weapon = Roster["units"][number]["sheet"]["weapons"][string];

/**
 * Changes to a sample unit, by name: more keywords or abilities, weapons'
 * keywords or characteristics by weapon name, weapons to add, and every
 * model's characteristics (an armour save).
 */
interface UnitEdit {
  keywords?: string[];
  chars?: Record<string, string>;
  abilities?: string[];
  weapons?: Record<string, { keywords?: string[]; chars?: Record<string, string> }>;
  add?: Weapon[];
}

/**
 * A sample army with rules added for a scenario (invented, like the samples):
 * a Hazardous weapon, a Transport, a weapon firing twice. Units not named stay as they are.
 */
export function withRules(roster: Roster, edits: Record<string, UnitEdit>): Roster {
  return {
    ...roster,
    units: roster.units.map((u) => {
      const e = edits[u.name];
      if (!e) return u;
      const weapons = Object.fromEntries([
        ...Object.entries(u.sheet.weapons).map(([id, w]) => {
          const we = e.weapons?.[w.name];
          return [
            id,
            we
              ? {
                  ...w,
                  keywords: [...w.keywords, ...(we.keywords ?? [])],
                  chars: { ...w.chars, ...we.chars },
                }
              : w,
          ];
        }),
        ...(e.add ?? []).map((w) => [w.id, w]),
      ]);
      return {
        ...u,
        sheet: {
          ...u.sheet,
          keywords: [...u.sheet.keywords, ...(e.keywords ?? [])],
          abilities: [...u.sheet.abilities, ...(e.abilities ?? []).map((name) => ({ name, text: name }))],
          weapons,
        },
        models: e.chars
          ? u.models.map((m) => ({
              ...m,
              profile: { ...m.profile, chars: { ...m.profile.chars, ...e.chars } },
            }))
          : u.models,
      };
    }),
  };
}

/** The Table warnings (src/ui/warnings.ts) after a move, by check id: none when nothing moved. */
export function moveWarnings(state: GameState, events: GameEvent[]): string[] {
  if (!events.some((e) => e.type === "models/move" || e.type === "unit/move")) return [];
  return tableWarnings(state).map((w) => `warning ${w.checkId}`);
}
