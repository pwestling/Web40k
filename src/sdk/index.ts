import type { GameSystem, Id } from "../core/content/schema";
import type { GameState } from "../core/types";

/**
 * The game module API, version 1 (see the game modules spec, linked from
 * research/rules-schema.md). Built-in systems and rules packages both
 * implement it. Data stays in `system`; code is for what data can't say.
 *
 * Types only for now: the code procedure runner that executes `procedures`,
 * `actions`, `hooks` and `functions` comes next.
 */

export const MODULE_API = 1;

export interface GameModule<App = unknown> {
  /** Same as `system.id`. */
  id: Id;
  /** Semver. */
  version: string;
  api: typeof MODULE_API;
  /** Rules data: characteristics, keywords, effects, procedures, turn structure. */
  system: GameSystem;
  /** App glue: table layout, sample armies, rank rules (src/systems/app.ts). */
  app?: App;
  actions?: CodeAction[];
  procedures?: Record<Id, CodeProcedure>;
  hooks?: TurnHooks;
  /** Pure functions data can call with `{ call: "id", args }`. */
  functions?: Record<Id, PureFn>;
  /** Advisory warnings, run on every peer against its own state. */
  checks?: (view: GameView) => Warning[];
}

/** What a package's default export holds: additions to one or more systems. */
export interface PackageContents {
  rules?: GameSystem["rules"];
  actions?: (GameSystem["actions"][number] | CodeAction)[];
  procedures?: Record<Id, CodeProcedure>;
  functions?: Record<Id, PureFn>;
  hooks?: TurnHooks;
  abilityTimings?: GameSystem["abilityTimings"];
  /** A `system` package's whole module. */
  module?: GameModule;
}

export function definePackage(contents: PackageContents): PackageContents {
  return contents;
}

export interface CodeAction {
  id: Id;
  name: string;
  by: "unit" | "player";
  phases?: Id[];
  /** True, or why not. */
  available(view: GameView, actor: Actor): true | string;
  targets?(view: GameView, actor: Actor): Target[];
  run: CodeProcedure;
}

/**
 * A rule as a generator: it yields commands and gets their results back. It
 * must be deterministic: the host replays it from the start, feeding back the
 * recorded results, to resume after a reconnect or a change of host.
 */
export type CodeProcedure = (ctx: Ctx, args: Args) => Generator<Command, void, unknown>;

export interface TurnHooks {
  phaseStart?: Record<Id, CodeProcedure>;
  phaseEnd?: Record<Id, CodeProcedure>;
  roundStart?: CodeProcedure;
  activationEnd?: CodeProcedure;
}

export type PureFn = (view: GameView, ...args: unknown[]) => unknown;

export type Args = Record<string, unknown>;

export interface Actor {
  player: Id;
  unitId?: Id;
}

export interface Target {
  unitId?: Id;
  label: string;
}

export interface Warning {
  unitId?: Id;
  message: string;
}

/** Read-only game access; the runtime views in core/content/runtime.ts. */
export interface GameView {
  round: number;
  phase: Id | null;
  activePlayer: Id | null;
  unit(id: Id): unknown;
  units(player?: Id): unknown[];
  distance(a: Id, b: Id): number;
  visible(from: Id, to: Id): boolean;
  inCover(from: Id, to: Id): boolean;
  arc(of: Id, other: Id): Id | null;
  engaged(unitId: Id): Id[];
  /** This module's own state, `state.modules[id]`. */
  own: Record<string, unknown>;
  /** The whole game state, read-only (a worker holds the same replica). */
  state: Readonly<GameState>;
}

/** Commands a procedure yields; each result is recorded for replay. */
export type Command =
  | { cmd: "roll"; dice: string; label?: string; unitId?: Id; need?: number }
  | { cmd: "note"; text: string }
  | { cmd: "ask"; player: Id; question: string; options: { id: Id; label: string }[] }
  | { cmd: "run"; procedure: Id; roles: Record<string, Id> }
  | { cmd: "emit"; event: { type: string } & Record<string, unknown> }
  | { cmd: "set"; key: string; value: unknown };

export interface Ctx {
  view: GameView;
  /**
   * Dice from the host's rng; `unitId` files the roll under that unit (e.g. a "flee roll").
   * `need` marks each die as a success on that score or more, so the log reads "5 of 10" not a sum.
   */
  roll(dice: string, label?: string, unitId?: Id, need?: number): Command;
  /** A line in the game log. */
  note(text: string): Command;
  ask(player: Id, question: string, options: { id: Id; label: string }[]): Command;
  run(procedure: Id, roles: Record<string, Id>): Command;
  emit(event: { type: string } & Record<string, unknown>): Command;
  set(key: string, value: unknown): Command;
}
