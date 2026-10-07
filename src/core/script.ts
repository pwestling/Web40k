import type { Command, CodeProcedure, Ctx, GameView } from "../sdk";
import type { GameEvent, Rng } from "./actions";
import { parseDice, rollDice } from "./dice";
import { tableGeometry, unitView, type UnitView } from "./content/runtime";
import type { GeoQuery, Id } from "./content/schema";
import { currentSlot, systemOf } from "./content/turn";
import type { GameState, PlayerId } from "./types";

/**
 * Code procedures (the game modules spec, "Game module API"): a rule written
 * as a generator that yields commands. Only the host runs one, inside
 * resolveIntent; its effects reach peers as ordinary events inside a
 * `script/step` event, so the reducer never runs module code.
 *
 * To resume after an answer, a reconnect or a change of host, the host
 * replays the generator from the start against the state it started on,
 * feeding back the recorded results, until it reaches a command with no
 * result. The replay must yield the same commands, or the procedure is
 * stopped as nondeterministic.
 */

export interface ScriptState {
  /** Game system the procedure belongs to. */
  system: Id;
  procedure: Id;
  args: Record<string, unknown>;
  /** Who started it. */
  by: PlayerId;
  /** The state's seq when it started: replays run against the state then. */
  startSeq: number;
  /** Every command so far and its result, in order. */
  results: ScriptResult[];
  /** The question it is waiting on: the command after the last result. */
  waiting?: ScriptQuestion;
}

export interface ScriptQuestion {
  player: PlayerId;
  question: string;
  options: { id: Id; label: string }[];
}

export interface ScriptResult {
  /** The command, as JSON, to check a replay yields the same one. */
  command: string;
  value?: unknown;
}

/** What a step logs: the procedure's new state (null when it ended) and the events it emitted. */
export interface ScriptStep {
  type: "script/step";
  script: ScriptState | null;
  events: GameEvent[];
  /** Why it stopped early: an error in the module, or a nondeterministic replay. */
  error?: string;
}

/** A module's own state, `state.modules[module][key]`. */
/** A line in the game log, written by a module. */
export interface LogNote {
  type: "log/note";
  text: string;
}

export interface ModuleSet {
  type: "module/set";
  module: Id;
  key: string;
  value: unknown;
}

const procedures = new Map<Id, Record<Id, CodeProcedure>>();

/** Code procedures a game system's module provides. */
export function registerCode(system: Id, code: Record<Id, CodeProcedure>): void {
  procedures.set(system, { ...procedures.get(system), ...code });
}

export function codeProcedure(system: Id, id: Id): CodeProcedure | undefined {
  return procedures.get(system)?.[id];
}

/** Commands one step may run before it is stopped as a runaway loop. */
const MAX_COMMANDS = 5000;

export function startScript(
  state: GameState,
  procedure: Id,
  args: Record<string, unknown>,
  by: PlayerId,
  rng: Rng,
): ScriptStep {
  const script: ScriptState = {
    system: systemOf(state).id,
    procedure,
    args,
    by,
    startSeq: state.seq,
    results: [],
  };
  return stepScript(script, state, rng);
}

/**
 * Run a procedure from the start against `base` (the state at its startSeq),
 * replaying recorded results, then on until it ends or asks something new.
 * `answer` answers the question it was waiting on.
 */
export function stepScript(script: ScriptState, base: GameState, rng: Rng, answer?: Id): ScriptStep {
  const proc = codeProcedure(script.system, script.procedure);
  if (!proc)
    return { type: "script/step", script: null, events: [], error: `No procedure "${script.procedure}"` };
  let state = base;
  const ctx = makeCtx(() => state, script.system);
  const results = [...script.results];
  const events: GameEvent[] = [];
  const stop = (error: string): ScriptStep => ({ type: "script/step", script: null, events, error });
  try {
    const gen = proc(ctx, script.args);
    let input: unknown = undefined;
    for (let i = 0; ; i++) {
      if (i > MAX_COMMANDS) return stop(`"${script.procedure}" ran more than ${MAX_COMMANDS} commands`);
      const next = gen.next(input);
      if (next.done) return { type: "script/step", script: null, events };
      const cmd = next.value;
      const key = JSON.stringify(cmd);
      if (i < results.length) {
        // Replaying: same command, same result.
        if (results[i]!.command !== key) return stop(`"${script.procedure}" behaved differently on replay`);
        input = results[i]!.value;
        state = replayEffect(state, cmd);
        continue;
      }
      if (cmd.cmd === "ask") {
        const options = cmd.options.map((o) => o.id);
        if (answer === undefined || !options.includes(answer))
          return {
            type: "script/step",
            script: {
              ...script,
              results,
              waiting: { player: cmd.player, question: cmd.question, options: cmd.options },
            },
            events,
          };
        input = answer;
        answer = undefined;
        results.push({ command: key, value: input });
        continue;
      }
      const { value, emitted } = perform(cmd, rng, script, state);
      results.push(value === undefined ? { command: key } : { command: key, value });
      events.push(...emitted);
      for (const e of emitted) state = replayEffect(state, e);
      input = value;
    }
  } catch (e) {
    return stop(`"${script.procedure}" failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Run a new command: roll dice, or turn an emit or set into events. */
function perform(
  cmd: Command,
  rng: Rng,
  script: ScriptState,
  state: GameState,
): { value?: unknown; emitted: GameEvent[] } {
  switch (cmd.cmd) {
    case "roll": {
      const dice = parseDice(cmd.dice);
      const { rolls, total } = rollDice(dice, rng);
      const sides = dice.sides;
      return {
        value: { rolls, total },
        emitted: [
          {
            type: "dice/roll",
            roll: {
              // A unit's roll is its owner's, whoever started the rule.
              by: (cmd.unitId && state.units[cmd.unitId]?.owner) || script.by,
              sides,
              results: rolls,
              ...(cmd.label ? { label: cmd.label } : {}),
              ...(cmd.unitId ? { unitId: cmd.unitId } : {}),
              ...(cmd.need ? { need: cmd.need } : {}),
            },
          },
        ],
      };
    }
    case "emit":
      return { emitted: [cmd.event as GameEvent] };
    case "note":
      return { emitted: [{ type: "log/note", text: cmd.text }] };
    case "set":
      return { emitted: [{ type: "module/set", module: script.system, key: cmd.key, value: cmd.value }] };
    case "run":
      throw new Error("ctx.run is not supported yet");
    case "ask":
      throw new Error("unreachable");
  }
}

/** Re-apply what a replayed command did, so later reads see it. */
function replayEffect(state: GameState, x: Command | GameEvent): GameState {
  // Imported lazily: the reducer imports this module for its event types.
  if ("cmd" in x) {
    if (x.cmd === "emit") return applyEventRef.fn(state, x.event as GameEvent);
    return state;
  }
  if (x.type === "dice/roll") return state;
  return applyEventRef.fn(state, x);
}

/** Set by the reducer, which can't be imported here without a cycle. */
export const applyEventRef: { fn: (state: GameState, event: GameEvent) => GameState } = {
  fn: (s) => s,
};

function makeCtx(current: () => GameState, module: Id): Ctx {
  return {
    get view() {
      return gameView(current(), module);
    },
    roll: (dice, label, unitId, need) => ({
      cmd: "roll",
      dice,
      ...(label ? { label } : {}),
      ...(unitId ? { unitId } : {}),
      ...(need ? { need } : {}),
    }),
    note: (text) => ({ cmd: "note", text }),
    ask: (player, question, options) => ({ cmd: "ask", player, question, options }),
    run: (procedure, roles) => ({ cmd: "run", procedure, roles }),
    emit: (event) => ({ cmd: "emit", event }),
    set: (key, value) => ({ cmd: "set", key, value }),
  };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Read-only access to the game for module code. */
export function gameView(state: GameState, module: Id): GameView {
  const system = systemOf(state);
  const views = new Map<string, UnitView>();
  const unit = (id: Id): UnitView | undefined => {
    if (!views.has(id)) {
      const u = state.units[id];
      if (u) views.set(id, unitView(state, system, u));
    }
    return views.get(id);
  };
  const geo = tableGeometry(state, system);
  const ask = (query: GeoQuery, a: Id, b: Id) =>
    geo(query, { scope: { a: unit(a) ?? null, b: unit(b) ?? null } });
  const active = Object.values(state.players).find((p) => p.seat === state.turn.activeSeat);
  const view: GameView = {
    round: state.turn.round,
    phase: currentSlot(state)?.id ?? null,
    activePlayer: active?.id ?? null,
    unit,
    units: (player) =>
      Object.values(state.units)
        .filter((u) => !player || u.owner === player)
        .flatMap((u) => {
          const v = unit(u.id);
          return v && v.models.length ? [v] : [];
        }),
    distance: (a, b) => round4(Number(ask({ kind: "distance", from: "a", to: "b" }, a, b))),
    visible: (a, b) => !!ask({ kind: "visible", from: "a", to: "b" }, a, b),
    inCover: (a, b) => !!ask({ kind: "cover", from: "a", to: "b" }, a, b),
    arc: (of, other) =>
      system.arcs?.find((arc) => !!ask({ kind: "inArc", from: "a", to: "b", arc: arc.id }, of, other))?.id ??
      null,
    engaged: (id) => {
      const me = state.units[id];
      const range = system.constants?.engagementRange ?? 1;
      return Object.values(state.units)
        .filter((u) => me && u.owner !== me.owner && unit(u.id)?.models.length)
        .filter((u) => view.distance(id, u.id) <= range + 1e-4)
        .map((u) => u.id);
    },
    own: (state.modules?.[module] ?? {}) as Record<string, unknown>,
    state,
  };
  return view;
}
