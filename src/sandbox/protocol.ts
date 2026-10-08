import type { GameEvent, GameRecord, Intent, Layout, LoggedEvent, Objective, Zone } from "../core";
import type { GameSystem } from "../core/content/schema";
import type { MissionCard, PanelSpec, ScoringRule } from "../sdk";
import type { SystemModule } from "../systems/app";
import type { ImportedRoster } from "../systems/wh40k/roster";
import type { Rng } from "../core/actions";
import type { SystemAdditions } from "../core/content/systems";
import type { HookTable } from "../core/script";

/**
 * Messages between the app and the package sandbox (a Worker started inside
 * a sandboxed iframe; see host.ts). The worker keeps a replica of the game
 * record, folded with the same reducer, so calls carry ids and intents,
 * never the whole state.
 */
export type ToSandbox =
  | { id: number; t: "load"; packages: { hash: string; source: string }[] }
  | { id: number; t: "init"; record: GameRecord }
  | { id: number; t: "events"; events: LoggedEvent[] }
  | { id: number; t: "resolve"; intent: Intent; from: string; seed: number }
  | { id: number; t: "actions"; unitId: string; player: string }
  /** A package game's app glue that depends on the game: rank rules, what's left undone, its panel. */
  | { id: number; t: "appState" }
  | { id: number; t: "importRoster"; fileName: string; data: Uint8Array }
  /** The module workshop's soak worker only (src/workshop/soakWorker.ts): a bot game of a draft package. */
  | { id: number; t: "soak"; source: string; seed: number; untilRound?: number }
  /** The workshop's soak worker only: load a draft and say what went wrong (Loaded). */
  | { id: number; t: "check"; source: string };

export type FromSandbox =
  | { id: number; t: "ok"; value?: unknown }
  | { id: number; t: "error"; error: string }
  /** The worker is up and listening. */
  | { id: 0; t: "ready" };

/** What a load reports: the code each package added, by system. */
export interface Loaded {
  packages: {
    hash: string;
    systems: string[];
    procedures: string[];
    actions: string[];
    /** Data the app adds to the same systems on its side (core/content/systems.ts extendSystem). */
    data: SystemAdditions;
    /** Turn hooks, by procedure id, for the host to start (core/script.ts). */
    hooks: HookTable;
    /** A whole game system the package provides. */
    provides?: Provided;
  }[];
  errors: { hash: string; error: string }[];
}

/** A whole-game package's system, and what its app glue gave in the sandbox, as data. */
export interface Provided {
  system: GameSystem;
  app: {
    samples: ImportedRoster[];
    layout: Layout;
    /** Every sample army players can pick (PackageApp.armies), or none. */
    armies: ImportedRoster[];
    /** Missions as data: their setup for `table`, and their rules and cards less the code. */
    missions: ProvidedMission[];
    /** Which of the game-dependent hooks the package has (they run in the sandbox). */
    has: {
      importRoster: boolean;
      rankRules: boolean;
      leaving: boolean;
      sidePanel: boolean;
      missions: boolean;
    };
  } & Pick<
    SystemModule,
    "templateCategory" | "templates" | "specialDice" | "scatter" | "fleeDice" | "chargeRoll"
  >;
}

/** A package mission without its code: `suggest`s are answered in the sandbox (AppState.scores). */
export interface ProvidedMission {
  id: string;
  name: string;
  summary: string;
  hand?: number;
  /** The table `setup` was worked out for, and what it gave. */
  table: { width: number; depth: number };
  setup: { zones: Zone[]; objectives: Objective[] };
  scoring: Omit<ScoringRule, "suggest">[];
  deck?: Omit<MissionCard, "suggest">[];
}

/** A package game's app glue for the current state (PackageApp in src/sdk), worked out in the sandbox. */
export interface AppState {
  seq: number;
  /**
   * The chosen package mission's suggestions: by `${rule}:${round}:${seat}` for
   * each scoring moment so far (null: nothing to score), and by `${card}:${seat}`
   * for its cards as the table stands.
   */
  scores: Record<string, { vp: number; why: string } | null>;
  cards: Record<string, { vp: number; why: string }>;
  /** The code actions each unit can take now, by name ("What can I do now?"). */
  ready: Record<string, string[]>;
  /** Each package mission's setup worked out for the table being played on (#43), and that table's size. */
  setups: Record<string, { zones: Zone[]; objectives: Objective[] }>;
  table: { width: number; depth: number } | null;
  /** Rank width and bonus cap per unit, for games with rankRules. */
  ranks: Record<string, { width: number; maxBonus: number }>;
  leaving: string[];
  panel: PanelSpec | null;
}

/** A package's code action as the unit card shows it, worked out in the sandbox. */
export interface ActionRow {
  id: string;
  name: string;
  /** True, or why not. */
  available: true | string;
  targets: { unitId?: string; label: string }[];
  /** Whether it needs a target picked. */
  targeted: boolean;
}

export type Resolved = GameEvent | null;

/**
 * The host draws one number from its rng per intent and the sandbox rolls
 * from it, so dice still come from the host and a replay of the log never
 * needs them again (results are in the events). mulberry32.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
