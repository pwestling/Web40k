import type { Command, CodeProcedure, Ctx, GameView, RunResult, TurnHooks } from "../sdk";
import { viewRef } from "./content/calls";
import { procedureEnv } from "./content/play";
import { advance, findProcedure, startRun, type RoleRef } from "./content/runner";
import type { GameEvent, Intent, Rng } from "./actions";
import { parseDice, rollDice } from "./dice";
import { tableGeometry, unitView, type UnitView } from "./content/runtime";
import type { GeoQuery, Id } from "./content/schema";
import { currentSlot, systemOf } from "./content/turn";
import { isCommitment, revealMatches, secretOf } from "./secrets";
import type { GameState, PlayerId } from "./types";
import { opposed } from "./teams";

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
  /**
   * A secret choice (ctx.secret): the player's device keeps the option it
   * picks and answers with its commitment. Or a reveal (ctx.reveal): the
   * device answers with the value and salt, as JSON, with no question shown.
   */
  secret?: string;
  reveal?: string;
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
  /** On the step that starts a procedure: its id (the script is gone already if it ended at once). */
  started?: Id;
}

/** A module's own state, `state.modules[module][key]`. */
/** A line in the game log, written by a module. */
export interface LogNote {
  type: "log/note";
  text: string;
}

/**
 * A campaign rule's award to one unit, emitted by a module's `afterGame`
 * hook (sdk TurnHooks). It changes nothing on the table; the campaign book
 * reads it from the log when it records the game (src/campaign/rules.ts).
 */
export interface CampaignAward {
  type: "campaign/award";
  /** The campaign unit (src/campaign/book.ts unitKey). */
  key: string;
  /** The unit on the table it was. */
  unitId?: Id;
  /** Experience gained (or lost, below zero). */
  xp?: number;
  /** A battle honour or scar to add, in the rule's words. */
  honour?: string;
  scar?: string;
}

export interface ModuleSet {
  type: "module/set";
  module: Id;
  key: string;
  value: unknown;
}

const procedures = new Map<Id, Record<Id, CodeProcedure>>();
viewRef.fn = (state, module) => gameView(state, module);

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
  return { ...stepScript(script, state, rng), started: procedure };
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
        for (const e of replayEvents(cmd, results[i]!.value, script)) state = applyEventRef.fn(state, e);
        input = cmd.cmd === "reveal" ? (results[i]!.value as { value: unknown }).value : results[i]!.value;
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
      if (cmd.cmd === "secret" || cmd.cmd === "reveal") {
        const got = secretAnswer(cmd, state, answer);
        answer = undefined;
        if (got === undefined) {
          const waiting: ScriptQuestion =
            cmd.cmd === "secret"
              ? { player: cmd.player, question: cmd.question, options: cmd.options, secret: cmd.key }
              : { player: cmd.player, question: `Reveal ${cmd.key}`, options: [], reveal: cmd.key };
          return { type: "script/step", script: { ...script, results, waiting }, events };
        }
        results.push({ command: key, value: got });
        const emitted = replayEvents(cmd, got, script);
        events.push(...emitted);
        for (const e of emitted) state = applyEventRef.fn(state, e);
        input = cmd.cmd === "reveal" ? (got as { value: unknown }).value : got;
        continue;
      }
      const { value, emitted } = perform(cmd, rng, script, state);
      results.push(value === undefined ? { command: key } : { command: key, value });
      events.push(...emitted);
      for (const e of emitted) if (e.type !== "dice/roll") state = applyEventRef.fn(state, e);
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
    case "set":
      return { emitted: replayEvents(cmd, undefined, script) };
    case "note":
      return { emitted: [{ type: "log/note", text: cmd.text }] };
    case "run": {
      const env = { ...procedureEnv(state, rng), autoAnswer: true };
      const roles: Record<string, RoleRef> = {};
      for (const [k, v] of Object.entries(cmd.roles)) roles[k] = typeof v === "string" ? { unit: v } : v;
      let run = startRun(env, cmd.procedure, roles);
      for (let i = 0; !run.done && i < 100; i++) run = advance(env, run);
      if (!run.done) throw new Error(`"${cmd.procedure}" didn't finish`);
      const steps: RunResult["steps"] = {};
      for (const r of run.records)
        steps[r.id] = {
          in: r.in,
          out: r.out,
          ...(r.successes !== undefined ? { successes: r.successes } : {}),
          ...(r.dice?.length ? { dice: r.dice.map((d) => d.value) } : {}),
        };
      const value: RunResult = { steps, outcomes: run.outcomes };
      // "Battle-shock test: test 0/1" in the log, like a procedure run from the panel.
      const rolled = run.records
        .filter((r) => r.dice?.length)
        .map((r) => `${r.id} ${r.successes ?? 0}/${r.in}`);
      const name = findProcedure(env.system, cmd.procedure).name ?? cmd.procedure;
      const note: GameEvent = {
        type: "log/note",
        text: `${name}${rolled.length ? `: ${rolled.join(", ")}` : ""}`,
      };
      return { value, emitted: [note, ...replayEvents(cmd, value, script)] };
    }
    case "ask":
    case "secret":
    case "reveal":
      throw new Error("unreachable");
  }
}

/**
 * A secret's result from the answer: for ctx.secret, the commitment the
 * player's device sent; for ctx.reveal, `{ value, salt }` once it matches the
 * commitment (or at once, if it was revealed already). Undefined while waiting.
 */
function secretAnswer(
  cmd: Extract<Command, { cmd: "secret" | "reveal" }>,
  state: GameState,
  answer: string | undefined,
): unknown {
  const entry = secretOf(state, cmd.player, cmd.key);
  if (cmd.cmd === "secret") {
    if (entry) throw new Error(`${cmd.player} already committed "${cmd.key}"`);
    return isCommitment(answer) ? answer : undefined;
  }
  if (!entry) throw new Error(`${cmd.player} has no secret "${cmd.key}"`);
  if (entry.revealed) return { value: entry.revealed.value, salt: "" };
  if (answer === undefined) return undefined;
  try {
    const { value, salt } = JSON.parse(answer) as { value: unknown; salt: string };
    return revealMatches(entry, value, String(salt)) ? { value, salt: String(salt) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The events a command emitted, rebuilt from the command and its recorded
 * result, so a replay sees the table as it was. Rolls change nothing; a data
 * procedure's changes are in its result.
 */
function replayEvents(cmd: Command, value: unknown, script: ScriptState): GameEvent[] {
  switch (cmd.cmd) {
    case "emit":
      return [cmd.event as GameEvent];
    case "set":
      return [{ type: "module/set", module: script.system, key: cmd.key, value: cmd.value }];
    case "run":
      return [{ type: "procedure/outcomes", outcomes: (value as RunResult).outcomes }];
    case "secret":
      return [
        {
          type: "secret/commit",
          player: cmd.player,
          secrets: [{ key: cmd.key, commitment: String(value) }],
          label: `a secret choice (${cmd.question})`,
        },
      ];
    case "reveal": {
      const { value: v, salt } = value as { value: unknown; salt: string };
      // Already revealed before this rule asked: nothing to add to the table.
      if (!salt) return [];
      return [{ type: "secret/reveal", player: cmd.player, key: cmd.key, value: v, salt }];
    }
    default:
      return [];
  }
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
    secret: (player, key, question, options) => ({ cmd: "secret", player, key, question, options }),
    reveal: (player, key) => ({ cmd: "reveal", player, key }),
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
        .filter((u) => me && opposed(state, u.owner, me.owner) && unit(u.id)?.models.length)
        .filter((u) => view.distance(id, u.id) <= range + 1e-4)
        .map((u) => u.id);
    },
    own: (state.modules?.[module] ?? {}) as Record<string, unknown>,
    state,
  };
  return view;
}

/** Turn hooks by system: which procedures (by id) run when phases and rounds start and end. */
export interface HookTable {
  phaseStart?: Record<Id, Id[]>;
  phaseEnd?: Record<Id, Id[]>;
  roundStart?: Id[];
  activationEnd?: Id[];
  /** Campaign games only: started by the campaign book, not by turns (src/campaign/rules.ts). */
  beforeGame?: Id[];
  afterGame?: Id[];
}

const hooks = new Map<Id, Map<string, HookTable>>();

/** A module's or package's turn hooks (`owner` keeps each one's apart, so a package's can be taken off again). */
export function registerHooks(system: Id, owner: string, table: HookTable): void {
  const bySystem = hooks.get(system) ?? new Map<string, HookTable>();
  bySystem.set(owner, table);
  hooks.set(system, bySystem);
}

export function unregisterHooks(owner: string): void {
  for (const bySystem of hooks.values()) bySystem.delete(owner);
}

/**
 * A module's TurnHooks as procedures: each gets an id (`hook:<owner>:phaseStart:shooting`),
 * for registerCode, and the table that names them, for registerHooks.
 */
export function hookProcedures(
  owner: string,
  h: TurnHooks,
): { procedures: Record<Id, CodeProcedure>; table: HookTable } {
  const procedures: Record<Id, CodeProcedure> = {};
  const table: HookTable = {};
  const add = (key: string, proc: CodeProcedure) => {
    const id = `hook:${owner}:${key}`;
    procedures[id] = proc;
    return id;
  };
  for (const kind of ["phaseStart", "phaseEnd"] as const) {
    const byPhase = h[kind];
    if (!byPhase) continue;
    table[kind] = Object.fromEntries(
      Object.entries(byPhase).map(([phase, p]) => [phase, [add(`${kind}:${phase}`, p)]]),
    );
  }
  if (h.roundStart) table.roundStart = [add("roundStart", h.roundStart)];
  if (h.activationEnd) table.activationEnd = [add("activationEnd", h.activationEnd)];
  if (h.beforeGame) table.beforeGame = [add("beforeGame", h.beforeGame)];
  if (h.afterGame) table.afterGame = [add("afterGame", h.afterGame)];
  return { procedures, table };
}

/** A system's campaign hooks, module and packages together, in the order they were registered. */
export function campaignHooks(system: Id): { beforeGame: Id[]; afterGame: Id[] } {
  const tables = [...(hooks.get(system)?.values() ?? [])];
  return {
    beforeGame: tables.flatMap((t) => t.beforeGame ?? []),
    afterGame: tables.flatMap((t) => t.afterGame ?? []),
  };
}

/**
 * The hook procedures an event sets off (phase end, round start, phase start,
 * activation end, in that order), as intents the host starts one after
 * another (net/session.ts). Each gets `{ phase, round, player }`.
 */
export function hookIntents(before: GameState, after: GameState, event: GameEvent): Intent[] {
  const bySystem = hooks.get(systemOf(after).id);
  if (!bySystem?.size || !event.type.startsWith("turn/") || event.type === "turn/prev") return [];
  const tables = [...bySystem.values()];
  const active = (s: GameState) =>
    Object.values(s.players).find((p) => p.seat === s.turn.activeSeat)?.id ?? "";
  const out: Intent[] = [];
  const start = (ids: Id[] | undefined, s: GameState, phase: Id | undefined) => {
    for (const procedure of ids ?? [])
      out.push({
        type: "script/start",
        procedure,
        args: { ...(phase ? { phase } : {}), round: s.turn.round, player: active(s) },
      });
  };
  if (event.type === "turn/endActivation")
    for (const t of tables) start(t.activationEnd, before, currentSlot(before)?.id);
  const was = currentSlot(before)?.id;
  const now = currentSlot(after)?.id;
  const moved =
    before.turn.round !== after.turn.round || before.turn.activeSeat !== after.turn.activeSeat || was !== now;
  if (!moved) return out;
  if (before.turn.round > 0 && was) for (const t of tables) start(t.phaseEnd?.[was], before, was);
  if (after.turn.round > 0 && after.turn.round !== before.turn.round)
    for (const t of tables) start(t.roundStart, after, now);
  if (after.turn.round > 0 && now) for (const t of tables) start(t.phaseStart?.[now], after, now);
  return out;
}
