const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./Editor-SAu-D91y.js","./react-DB-4Zxce.js","./jsx-runtime-BtH0gOTJ.js"])))=>i.map(i=>d[i]);
import{i as e,t}from"./react-DB-4Zxce.js";import{Dr as n,En as r,Tr as i,dr as a,kr as o,mr as s,s as c,u as l,ur as u}from"./store-BMRMsvRC.js";import{t as d}from"./gameLog-w54jCBOa.js";import{t as f}from"./version-CKhFwQiM.js";import{t as p}from"./jsx-runtime-BtH0gOTJ.js";import{a as m}from"./lesson-Qvj6d4mj.js";import{h,i as g,m as _}from"./index-DlVzZE9F.js";import{c as v,i as y,l as b,r as x}from"./runtime-D-Uvt5qc.js";var S=e(t(),1),C=`import type { GameSystem, Id } from "../core/content/schema";
import type { GameState, Objective, Zone } from "../core/types";
import type { Outcome, RoleRef } from "../core/content/runner";

/**
 * The game module API, version 1 (see the game modules spec, linked from
 * research/rules-schema.md). Built-in systems and rules packages both
 * implement it. Data stays in \`system\`; code is for what data can't say.
 *
 * Types only for now: the code procedure runner that executes \`procedures\`,
 * \`actions\`, \`hooks\` and \`functions\` comes next.
 */

export const MODULE_API = 1;

export interface GameModule<App = unknown> {
  /** Same as \`system.id\`. */
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
  /** Pure functions data can call with \`{ call: "id", args }\`. */
  functions?: Record<Id, PureFn>;
  /**
   * Advisory warnings, run on every peer against its own state and shown in
   * the Table warnings panel (src/ui/warnings.ts), next to the system's data
   * \`checks\`. A warning whose \`id\` matches a data check replaces that check.
   * Built-in modules only for now: a package's code stays in its sandbox.
   */
  checks?: (view: GameView) => Warning[];
  /** Data check ids that \`checks\` replaces, so they don't run twice. */
  replacesChecks?: Id[];
}

/** What a package's default export holds: additions to one or more systems. */
export interface PackageContents {
  rules?: GameSystem["rules"];
  actions?: (GameSystem["actions"][number] | CodeAction)[];
  procedures?: Record<Id, CodeProcedure>;
  functions?: Record<Id, PureFn>;
  hooks?: TurnHooks;
  abilityTimings?: GameSystem["abilityTimings"];
  /** A \`system\` package's whole module. */
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
  /** Whether the unit could ever take it (a character's action); hidden otherwise. */
  applies?(view: GameView, actor: Actor): boolean;
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
  /**
   * Campaign rules (roadmap 24b), for games played for a campaign book. The
   * book starts \`beforeGame\` once the battle begins, and \`afterGame\` once it
   * is over and scored, before it records the game. Both get
   * \`{ units: CampaignStory[] }\`. \`afterGame\` hands out experience, honours
   * and scars by emitting \`{ type: "campaign/award", key, xp?, honour?, scar? }\`
   * (rolls through \`ctx.roll\`, so everyone sees them in the log);
   * \`beforeGame\` applies carried-over effects with ordinary table events.
   */
  beforeGame?: CodeProcedure;
  afterGame?: CodeProcedure;
}

/** A campaign unit's story as the campaign hooks see it (src/campaign/book.ts CampaignUnit). */
export interface CampaignStory {
  /** The campaign unit's key, for awards. */
  key: Id;
  /** The unit on the table. */
  unitId: Id;
  name: string;
  owner: Id;
  /** Before this game. */
  games: number;
  kills: number;
  xp: number;
  honours: string;
  scars: string;
  /** This game, for afterGame: enemy models it destroyed, and whether any of it is left. */
  slain?: number;
  survived?: boolean;
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
  /** Which check this is, e.g. "coherency"; the same id as a data check replaces it. */
  id?: Id;
  unitId?: Id;
  message: string;
  severity?: "info" | "warning";
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
  /** This module's own state, \`state.modules[id]\`. */
  own: Record<string, unknown>;
  /** The whole game state, read-only (a worker holds the same replica). */
  state: Readonly<GameState>;
}

/** Commands a procedure yields; each result is recorded for replay. */
export type Command =
  | { cmd: "roll"; dice: string; label?: string; unitId?: Id; need?: number }
  | { cmd: "note"; text: string }
  | { cmd: "ask"; player: Id; question: string; options: { id: Id; label: string }[] }
  | { cmd: "run"; procedure: Id; roles: Record<string, Id | RoleRef> }
  | { cmd: "emit"; event: { type: string } & Record<string, unknown> }
  | { cmd: "set"; key: string; value: unknown }
  | { cmd: "secret"; player: Id; key: string; question: string; options: { id: Id; label: string }[] }
  | { cmd: "reveal"; player: Id; key: string };

export interface Ctx {
  view: GameView;
  /**
   * Dice from the host's rng; \`unitId\` files the roll under that unit (e.g. a "flee roll").
   * \`need\` marks each die as a success on that score or more, so the log reads "5 of 10" not a sum.
   */
  roll(dice: string, label?: string, unitId?: Id, need?: number): Command;
  /** A line in the game log. */
  note(text: string): Command;
  ask(player: Id, question: string, options: { id: Id; label: string }[]): Command;
  /**
   * Run one of the system's data procedures (an attack sequence, a test) to
   * the end with the host's dice: a unit id fills a role, or pass a RoleRef
   * for a weapon, model or player. Reaction windows take their default
   * answer. Its table changes are applied, and the result says what each
   * step rolled.
   */
  run(procedure: Id, roles: Record<string, Id | RoleRef>): Command;
  emit(event: { type: string } & Record<string, unknown>): Command;
  set(key: string, value: unknown): Command;
  /**
   * Ask a player to choose an option in secret (a hidden order, a secret
   * objective). Their device keeps the choice and puts only a commitment on
   * the table (\`view.state.secrets[player][key]\`), so nobody else, the host
   * included, learns it. The result is the commitment.
   */
  secret(player: Id, key: string, question: string, options: { id: Id; label: string }[]): Command;
  /**
   * Have a player reveal a secret they committed. Their device sends the
   * value, every player checks it against the commitment, and the result is
   * the value (straight away if it was already revealed).
   */
  reveal(player: Id, key: string): Command;
}

/** What \`ctx.run\` hands back: each step's tokens in and out and its successes, and the table changes made. */
export interface RunResult {
  steps: Record<Id, { in: number; out: number; successes?: number; dice?: number[] }>;
  outcomes: Outcome[];
}

/**
 * A package game's side panel, described as data (a package can't ship React
 * components: its code runs in the sandbox). The app draws it and runs a
 * button's procedure when it is pressed.
 */
export interface PanelSpec {
  title: string;
  lines?: string[];
  buttons?: {
    label: string;
    procedure: Id;
    args?: Args;
    /** Who presses it; the player whose turn it is when missing. */
    player?: Id;
    /** Why it can't be pressed now. */
    disabled?: string;
  }[];
}

/**
 * The app glue a whole-game package gives (\`module.app\`). It runs in the
 * sandbox: \`sample\` and \`layout\` once when the package loads, \`rankRules\`,
 * \`leaving\` and \`sidePanel\` after every event, \`importRoster\` when a player
 * picks a file.
 */
export interface PackageApp {
  sample(seat: 0 | 1): unknown;
  layout(table: GameState["table"]): unknown;
  importRoster?(fileName: string, data: Uint8Array): unknown;
  rankRules?(game: GameState, unit: GameState["units"][string]): { width: number; maxBonus: number };
  leaving?(game: GameState): string[];
  sidePanel?(view: GameView): PanelSpec | null;
  templateCategory?: Record<string, string>;
  fleeDice?: string;
  chargeRoll?: { count: number; sides: number; keep: "highest" | "sum" };
}

/**
 * A mission: where the armies deploy, where the objectives are, how victory
 * points are scored and, optionally, a deck of secret mission cards. Players
 * pick one at setup. At each scoring moment the app suggests each side's
 * score from \`suggest\` and a player of that side confirms it (or changes it);
 * nothing is scored without a person saying so.
 */
export interface Mission {
  id: Id;
  name: string;
  /** One or two sentences for the picker. */
  summary: string;
  /** Deployment zones and objective markers for a table this size (terrain is left alone). */
  setup(table: { width: number; depth: number }): { zones: Zone[]; objectives: Objective[] };
  scoring: ScoringRule[];
  /** Secret mission cards: each player draws in secret (src/core/secrets.ts) and reveals one to score it. */
  deck?: MissionCard[];
  /** Cards each player may hold at once. */
  hand?: number;
}

/** When a rule scores: the end of a phase (the side whose turn it was), the end of each round, or the battle's end (every side). */
export type ScoringMoment = { phaseEnd: Id; fromRound?: number } | { roundEnd: true } | { gameEnd: true };

export interface ScoringRule {
  id: Id;
  name: string;
  at: ScoringMoment;
  /** The side's score at that moment, as the table stood then; null when it scores nothing. */
  suggest(game: GameState, seat: number): { vp: number; why: string } | null;
  /** At a real table (table companion), what to ask the player instead, the app working out the VP. */
  ask?: ScoreQuestion;
}

/** A scoring rule's question for players at a real table (UX 278), and what each answer scores. */
export interface ScoreQuestion {
  question: string;
  answers: { label: string; vp: number; why: string }[];
}

export interface MissionCard {
  id: Id;
  name: string;
  /** What it asks for, in the player's words. */
  text: string;
  /** Its score when revealed, as the table stands. */
  suggest(game: GameState, seat: number): { vp: number; why: string };
  /** At a real table, the question that scores it. */
  ask?: ScoreQuestion;
}
`,w=`// A starter game for the module workshop: a skirmish game, model by model.
// Each player in turn moves, then fights. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// How packages work: docs/packages.md. The types: src/sdk/index.ts.

export const manifest = {
  id: "me.my-skirmish", // change "me" to your name: it must stay the same across versions
  name: "My skirmish game",
  version: "0.1.0",
  author: "Me",
  api: 1,
  kind: "system",
  systems: ["my-skirmish"],
  requires: [],
  adds: "A whole small game: move, then fight; each hit takes a wound.",
};

/** The rules as data: characteristics, dice and the turn (src/core/content/schema.ts). */
const system = {
  id: "my-skirmish",
  name: "My skirmish game",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "Hit", name: "Hits on", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  weaponKinds: ["melee"],
  terrain: [],
  unitShape: { kind: "skirmish" },
  rules: [],
  procedures: [],
  actions: [],
  turn: {
    rounds: 4,
    round: [
      {
        kind: "playerTurns",
        segments: [
          { kind: "phase", id: "move", name: "Move" },
          { kind: "phase", id: "fight", name: "Fight" },
        ],
      },
    ],
  },
};

/** A unit of \`count\` models with the same stats. */
function unit(name, count, stats) {
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: { shape: "round", diameterMm: 32 },
    sheet: { weapons: {}, abilities: [], keywords: [], points: count * 10 },
    models: Array.from({ length: count }, () => ({ profile: { name, chars }, weapons: [] })),
  };
}

/** One unit a side for the test table. */
const samples = [
  { name: "Red band", units: [unit("Red fighters", 5, { M: 6, A: 2, Hit: 4, W: 1 })], warnings: [] },
  { name: "Blue band", units: [unit("Blue fighters", 5, { M: 5, A: 1, Hit: 3, W: 2 })], warnings: [] },
];

const alive = (state, u) => u.modelIds.map((id) => state.models[id]).filter((m) => !m.destroyed);
const stat = (model, key) => Number(model.profile.chars[key]) || 0;

/** Enemy units within 1" of this one. */
function inReach(view, unitId) {
  const me = view.state.units[unitId];
  return Object.values(view.state.units).filter(
    (u) => u.owner !== me.owner && alive(view.state, u).length && view.distance(unitId, u.id) <= 1,
  );
}

/** Fight: every model rolls its Attacks; each roll of its Hits-on or more is a wound. */
function* fight(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  const fighters = alive(state, me);
  const need = Math.max(...fighters.map((m) => stat(m, "Hit")));
  const dice = fighters.reduce((n, m) => n + stat(m, "A"), 0);
  yield ctx.note(\`\${me.name} fight \${target.name}\`);
  const roll = yield ctx.roll(\`\${dice}d6\`, "hits", me.id, need);
  let wounds = roll.rolls.filter((r) => r >= need).length;
  for (const m of alive(state, target)) {
    if (!wounds) break;
    const take = Math.min(wounds, stat(m, "W") - (m.woundsLost ?? 0));
    wounds -= take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed: woundsLost >= stat(m, "W") });
  }
  yield ctx.set(\`fought:\${me.id}\`, state.turn.round);
}

export default {
  module: {
    id: "my-skirmish",
    version: "0.1.0",
    api: 1,
    system,
    app: {
      sample: (seat) => samples[seat],
      layout: () => ({ terrain: [], objectives: [], zones: [] }),
    },
    actions: [
      {
        id: "fight",
        name: "Fight",
        by: "unit",
        phases: ["fight"],
        available: (view, actor) => {
          if (view.own[\`fought:\${actor.unitId}\`] === view.round) return "Already fought this round";
          return inReach(view, actor.unitId).length ? true : 'No enemy within 1"';
        },
        targets: (view, actor) => inReach(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        run: fight,
      },
    ],
    procedures: {},
    hooks: {},
  },
};
`,T=`// A starter game for the module workshop: rank-and-flank regiments that move
// as blocks with a facing (wheel, reform, turn, march). Each player in turn
// moves, then the blocks in contact clash. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// How packages work: docs/packages.md. The types: src/sdk/index.ts.

export const manifest = {
  id: "me.my-ranked", // change "me" to your name: it must stay the same across versions
  name: "My rank-and-flank game",
  version: "0.1.0",
  author: "Me",
  api: 1,
  kind: "system",
  systems: ["my-ranked"],
  requires: [],
  adds: "A whole small game: regiments in blocks; the front rank strikes, rear ranks add a bonus.",
};

/** The rules as data: characteristics, dice and the turn (src/core/content/schema.ts). */
const system = {
  id: "my-ranked",
  name: "My rank-and-flank game",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "Hit", name: "Hits on", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  // Arcs from a block's facing: what is in front, on a flank or behind it.
  arcs: [
    { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
    { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
    { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
    { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
  ],
  weaponKinds: ["melee"],
  terrain: [],
  unitShape: { kind: "ranked", minFiles: 4, manoeuvres: ["wheel", "reform", "turn", "march"] },
  rules: [],
  procedures: [],
  actions: [],
  turn: {
    rounds: 4,
    round: [
      {
        kind: "playerTurns",
        segments: [
          { kind: "phase", id: "move", name: "Move" },
          { kind: "phase", id: "clash", name: "Clash" },
        ],
      },
    ],
  },
};

/** A regiment of \`count\` models with the same stats, \`files\` wide. */
function unit(name, count, stats, files = 5) {
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: { shape: "rect", widthMm: 25, depthMm: 25 },
    files,
    sheet: { weapons: {}, abilities: [], keywords: [], points: count * 10 },
    models: Array.from({ length: count }, () => ({ profile: { name, chars }, weapons: [] })),
  };
}

/** One regiment a side for the test table. */
const samples = [
  { name: "Red host", units: [unit("Red spears", 15, { M: 4, A: 1, Hit: 4, W: 1 })], warnings: [] },
  { name: "Blue host", units: [unit("Blue swords", 12, { M: 4, A: 1, Hit: 3, W: 1 }, 4)], warnings: [] },
];

const alive = (state, u) => u.modelIds.map((id) => state.models[id]).filter((m) => !m.destroyed);
const stat = (model, key) => Number(model.profile.chars[key]) || 0;

/** Enemy units within 1" of this one. */
function inReach(view, unitId) {
  const me = view.state.units[unitId];
  return Object.values(view.state.units).filter(
    (u) => u.owner !== me.owner && alive(view.state, u).length && view.distance(unitId, u.id) <= 1,
  );
}

/** Clash: the front rank rolls its Attacks, plus a die for each full rank behind it (up to 2). */
function* fight(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  const left = alive(state, me);
  const files = me.formation?.files ?? 5;
  const front = left.slice(0, files);
  const ranks = Math.min(2, Math.floor(left.length / files) - 1);
  const need = Math.max(...front.map((m) => stat(m, "Hit")));
  const dice = front.reduce((n, m) => n + stat(m, "A"), 0) + Math.max(0, ranks);
  yield ctx.note(\`\${me.name} clash with \${target.name}\`);
  const roll = yield ctx.roll(\`\${dice}d6\`, "hits", me.id, need);
  let wounds = roll.rolls.filter((r) => r >= need).length;
  for (const m of alive(state, target)) {
    if (!wounds) break;
    const take = Math.min(wounds, stat(m, "W") - (m.woundsLost ?? 0));
    wounds -= take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed: woundsLost >= stat(m, "W") });
  }
  yield ctx.set(\`fought:\${me.id}\`, state.turn.round);
}

export default {
  module: {
    id: "my-ranked",
    version: "0.1.0",
    api: 1,
    system,
    app: {
      sample: (seat) => samples[seat],
      layout: () => ({ terrain: [], objectives: [], zones: [] }),
    },
    actions: [
      {
        id: "clash",
        name: "Clash",
        by: "unit",
        phases: ["clash"],
        available: (view, actor) => {
          if (view.own[\`fought:\${actor.unitId}\`] === view.round) return "Already fought this round";
          return inReach(view, actor.unitId).length ? true : 'No enemy within 1"';
        },
        targets: (view, actor) => inReach(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        run: fight,
      },
    ],
    procedures: {},
    hooks: {},
  },
};
`,E=`// A starter game for the module workshop: alternating activations. Players
// take turns activating one unit at a time; an activated unit may move and
// shoot. The round ends when every unit has gone. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// How packages work: docs/packages.md. The types: src/sdk/index.ts.

export const manifest = {
  id: "me.my-activations", // change "me" to your name: it must stay the same across versions
  name: "My activation game",
  version: "0.1.0",
  author: "Me",
  api: 1,
  kind: "system",
  systems: ["my-activations"],
  requires: [],
  adds: "A whole small game: players alternate activating units, which move and shoot.",
};

/** The rules as data: characteristics, dice and the turn (src/core/content/schema.ts). */
const system = {
  id: "my-activations",
  name: "My activation game",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "Shots", name: "Shots", of: "model", type: "number" },
    { id: "Range", name: "Range", of: "model", type: "distance" },
    { id: "Hit", name: "Hits on", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  weaponKinds: ["ranged"],
  terrain: [],
  unitShape: { kind: "skirmish" },
  rules: [],
  procedures: [],
  actions: [],
  turn: {
    rounds: 4,
    round: [
      {
        // Players alternate: each activation is one unit's turn to move and shoot.
        kind: "alternate",
        id: "activations",
        pool: { kind: "units" },
        activation: [{ kind: "phase", id: "activation", name: "Activation", actions: ["shoot"] }],
      },
    ],
  },
};

/** A unit of \`count\` models with the same stats. */
function unit(name, count, stats) {
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: { shape: "round", diameterMm: 32 },
    sheet: { weapons: {}, abilities: [], keywords: [], points: count * 10 },
    models: Array.from({ length: count }, () => ({ profile: { name, chars }, weapons: [] })),
  };
}

/** Two units a side for the test table, so activations alternate. */
const samples = [
  {
    name: "Red squad",
    units: [
      unit("Red rifles", 5, { M: 6, Shots: 1, Range: 24, Hit: 4, W: 1 }),
      unit("Red gunner", 1, { M: 5, Shots: 3, Range: 30, Hit: 4, W: 2 }),
    ],
    warnings: [],
  },
  {
    name: "Blue squad",
    units: [
      unit("Blue rifles", 5, { M: 6, Shots: 1, Range: 24, Hit: 4, W: 1 }),
      unit("Blue scout", 1, { M: 8, Shots: 2, Range: 18, Hit: 3, W: 1 }),
    ],
    warnings: [],
  },
];

const alive = (state, u) => u.modelIds.map((id) => state.models[id]).filter((m) => !m.destroyed);
const stat = (model, key) => Number(model.profile.chars[key]) || 0;

/** Enemy units within this unit's range. */
function inReach(view, unitId) {
  const me = view.state.units[unitId];
  const range = Math.max(0, ...alive(view.state, me).map((m) => stat(m, "Range")));
  return Object.values(view.state.units).filter(
    (u) => u.owner !== me.owner && alive(view.state, u).length && view.distance(unitId, u.id) <= range,
  );
}

/** Shoot: every model rolls its Shots; each roll of its Hits-on or more is a wound. */
function* fight(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  const fighters = alive(state, me);
  const need = Math.max(...fighters.map((m) => stat(m, "Hit")));
  const dice = fighters.reduce((n, m) => n + stat(m, "Shots"), 0);
  yield ctx.note(\`\${me.name} shoot at \${target.name}\`);
  const roll = yield ctx.roll(\`\${dice}d6\`, "hits", me.id, need);
  let wounds = roll.rolls.filter((r) => r >= need).length;
  for (const m of alive(state, target)) {
    if (!wounds) break;
    const take = Math.min(wounds, stat(m, "W") - (m.woundsLost ?? 0));
    wounds -= take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed: woundsLost >= stat(m, "W") });
  }
  yield ctx.set(\`fought:\${me.id}\`, state.turn.round);
}

export default {
  module: {
    id: "my-activations",
    version: "0.1.0",
    api: 1,
    system,
    app: {
      sample: (seat) => samples[seat],
      layout: () => ({ terrain: [], objectives: [], zones: [] }),
    },
    actions: [
      {
        id: "shoot",
        name: "Shoot",
        by: "unit",
        phases: ["activations"],
        available: (view, actor) => {
          if (view.own[\`fought:\${actor.unitId}\`] === view.round) return "Already shot this round";
          return inReach(view, actor.unitId).length ? true : "No enemy in range";
        },
        targets: (view, actor) => inReach(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        run: fight,
      },
    ],
    procedures: {},
    hooks: {},
  },
};
`,D=`open-battle:workshop`;function O(){try{let e=JSON.parse(localStorage.getItem(D)??`null`);if(e&&Array.isArray(e.drafts))return e}catch{}return{drafts:[],current:null}}function k(e,t){try{localStorage.setItem(D,JSON.stringify({drafts:e,current:t}))}catch{}}function A(e){return{id:crypto.randomUUID().slice(0,8),source:e,updated:Date.now()}}function j(e){let t=s(e);return`error`in t?t.error:t.manifest}function M(e){let t=j(e);if(typeof t==`string`)return[t];let n=[];return t.kind!==`system`&&n.push(`The workshop tests whole games: set manifest.kind to "system".`),t.systems[0]||n.push(`Name the game's system id in manifest.systems.`),/export\s+default\b/.test(e)||n.push(`Export the game: export default { module }.`),n}function N(e){return`${e.id.replace(/[^\w.-]+/g,`-`)}-${e.version}.js`}var P=`https://github.com/pwestling/Web40k`,F=`${P}/blob/main/docs/community-modules.md`,I=`${P}/edit/main/docs/community-modules.md`;function L(e,t,n){let r=n||`<the module's raw URL>`;return[`## Add ${e.name} ${e.version} to the community modules`,``,e.adds??``,``,`Row for docs/community-modules.md:`,``,"```",`| [${e.name}](${r}) | ${e.version} | ${e.author??``} | ${e.systems.join(`, `)} | ${e.adds??``} | \`${t.slice(0,16)}\` |`,"```",``,`- Package id: \`${e.id}\` (kind: ${e.kind})`,`- SHA-256: \`${t}\``,`- Tested in the module workshop: the test table and the soak bot.`,`- No Games Workshop text, names or stats in the file.`].join(`
`)}var R=12e4;async function z(e,t,n){let r=null,i;try{let e=(await o(async()=>{let{default:e}=await import(`./_virtual_soak-worker-BJzfMF7i.js`);return{default:e}},[],import.meta.url)).default;i=await y.start(e,e=>r=e)}catch(e){let r=e instanceof Error?e.message:String(e);for(let e of t)n({seed:e,ok:!1,failures:[r],steps:0,round:0,finished:!1});return}try{for(let a of t)try{n(await i.call({t:`soak`,source:e,seed:a},R))}catch(e){if(n({seed:a,ok:!1,failures:[r??(e instanceof Error?e.message:String(e))],steps:0,round:0,finished:!1}),r)return}}finally{i.stop()}}var B=p(),V=`https://`,H=(0,S.lazy)(()=>o(()=>import(`./Editor-SAu-D91y.js`).then(e=>({default:e.Editor})),__vite__mapDeps([0,1,2]),import.meta.url)),U=[{id:`skirmish`,source:w,name:()=>i(`Skirmish`),what:()=>i(`Model by model: move, then fight.`)},{id:`ranked`,source:T,name:()=>i(`Ranked`),what:()=>i(`Regiment blocks that wheel and clash.`)},{id:`activations`,source:E,name:()=>i(`Alternating activations`),what:()=>i(`Players take turns activating one unit each.`)}];function W(){let[{drafts:e,current:t},n]=(0,S.useState)(O),r=e.find(e=>e.id===t)??null,a=h(e=>e.folded),o=h(e=>e.link),s=c(e=>e.session!==null),[l,d]=(0,S.useState)(`table`),[f,p]=(0,S.useState)(null),m=(e,t)=>{k(e,t),n({drafts:e,current:t})},g=t=>{let n=A(t);m([...e,n],n.id)},v=t=>{r&&m(e.map(e=>e.id===r.id?{...e,source:t,updated:Date.now()}:e),r.id)},y=()=>{if(!r||!confirm(i(`Delete this draft? This can't be undone.`)))return;let t=e.filter(e=>e.id!==r.id);m(t,t.at(-1)?.id??null)};(0,S.useEffect)(()=>{o&&(h.setState({link:null}),K(o).then(e=>{g(e),p(i(`Opened from {url}. Read it before you test it: saving runs its code in the sandbox.`,{url:o}))},e=>p(e.message)))},[o]);let b=async()=>{if(!r)return null;let t=M(r.source);if(t.length)return p(t[0]),null;let n=u.getState(),a=await n.add(new TextEncoder().encode(r.source),{own:!0});if(!a.ok)return p(a.error),null;n.trust(a.pkg.hash,!0),r.saved&&r.saved!==a.pkg.hash&&n.packages[r.saved]?.own&&J(r.saved),m(e.map(e=>e.id===r.id?{...e,saved:a.pkg.hash}:e),r.id);let o=a.pkg.manifest.systems[0],s=c.getState().game;return c.getState().session&&s.packages?.system?.id===o?(Y(a.pkg.hash),p(i(`Saved and reloaded onto the test table.`))):p(i(`Saved.`)),a.pkg.hash};if(a&&s)return(0,B.jsx)(`button`,{className:`workshop-tab`,onClick:()=>h.setState({folded:!1}),children:i(`Workshop`)});let x=r?j(r.source):null;return(0,B.jsxs)(`section`,{className:`workshop${s?` over-table`:``}`,role:s?`complementary`:`dialog`,"aria-label":i(`Module workshop`),children:[(0,B.jsxs)(`header`,{className:`workshop-head`,children:[(0,B.jsx)(`h2`,{children:i(`Module workshop`)}),e.length>0&&(0,B.jsx)(`select`,{"aria-label":i(`Draft`),value:t??``,onChange:t=>m(e,t.target.value),children:e.map(e=>{let t=j(e.source);return(0,B.jsx)(`option`,{value:e.id,children:typeof t==`string`?i(`Untitled draft`):`${t.name} ${t.version}`},e.id)})}),(0,B.jsx)(`span`,{className:`spacer`}),s&&(0,B.jsx)(`button`,{onClick:()=>h.setState({folded:!0}),title:i(`Fold the workshop to the side`),children:`⇥`}),(0,B.jsx)(`button`,{onClick:_,"aria-label":i(`Close the workshop`),children:`✕`})]}),r?(0,B.jsxs)(`div`,{className:`workshop-body`,children:[(0,B.jsxs)(`div`,{className:`workshop-code`,children:[(0,B.jsxs)(`div`,{className:`workshop-tools`,children:[(0,B.jsx)(`button`,{className:`primary`,onClick:()=>void b(),title:i(`Save (Ctrl+S)`),children:i(`Save`)}),(0,B.jsx)(X,{save:b}),(0,B.jsx)(`span`,{className:`spacer`}),(0,B.jsx)(`button`,{onClick:()=>m(e,null),children:i(`New draft`)}),(0,B.jsx)(`button`,{onClick:y,children:i(`Delete`)})]}),f&&(0,B.jsx)(`p`,{className:`workshop-note`,role:`status`,children:f}),(0,B.jsx)(q,{draft:r}),(0,B.jsx)(S.Suspense,{fallback:(0,B.jsx)(`div`,{className:`workshop-editor`,children:i(`Loading the editor…`)}),children:(0,B.jsx)(H,{doc:r.source,onChange:v,onSave:()=>void b(),label:i(`The package's code`)})})]}),(0,B.jsxs)(`aside`,{className:`workshop-side`,children:[(0,B.jsx)(`div`,{className:`tabs`,role:`tablist`,children:[[`table`,i(`Test table`)],[`soak`,i(`Soak bot`)],[`export`,i(`Export`)],[`sdk`,i(`SDK`)]].map(([e,t])=>(0,B.jsx)(`button`,{role:`tab`,"aria-selected":l===e,onClick:()=>d(e),children:t},e))}),l===`table`&&(0,B.jsx)(Z,{}),l===`soak`&&(0,B.jsx)(Q,{draft:r}),l===`export`&&typeof x!=`string`&&x&&(0,B.jsx)($,{draft:r}),l===`export`&&typeof x==`string`&&(0,B.jsx)(`p`,{children:x}),l===`sdk`&&(0,B.jsx)(ee,{})]})]}):(0,B.jsx)(G,{onPick:g})]})}function G({onPick:e}){let[t,n]=(0,S.useState)(``),[r,a]=(0,S.useState)(null);return(0,B.jsxs)(`div`,{className:`workshop-start`,children:[(0,B.jsx)(`p`,{children:i(`Write a whole game as one JavaScript file: its rules as data, with code where data won't do. Start from a template; the test table plays it as you go.`)}),(0,B.jsx)(`div`,{className:`workshop-templates`,children:U.map(t=>(0,B.jsxs)(`button`,{className:`workshop-template`,onClick:()=>e(t.source),children:[(0,B.jsx)(`strong`,{children:t.name()}),(0,B.jsx)(`span`,{children:t.what()})]},t.id))}),(0,B.jsxs)(`form`,{className:`workshop-link`,onSubmit:n=>{n.preventDefault(),a(null),K(t).then(e,e=>a(e.message))},children:[(0,B.jsxs)(`label`,{children:[i(`Open from a link`),(0,B.jsx)(`input`,{type:`url`,value:t,placeholder:V,onChange:e=>n(e.target.value),required:!0})]}),(0,B.jsx)(`button`,{type:`submit`,children:i(`Open`)}),r&&(0,B.jsx)(`p`,{className:`error`,children:r})]}),(0,B.jsxs)(`p`,{children:[(0,B.jsx)(`a`,{href:F,target:`_blank`,rel:`noreferrer`,children:i(`Community modules`)}),` · `,(0,B.jsx)(`a`,{href:`${F.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:i(`How packages work`)})]})]})}async function K(e){let t=e.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,`https://raw.githubusercontent.com/$1/`),n;try{n=await fetch(t)}catch{throw Error(i(`Couldn't fetch that link (it may not allow other sites to read it).`))}if(!n.ok)throw Error(i(`That link answered {status}.`,{status:n.status}));let r=await n.text();if(r.length>1048576)throw Error(i(`That's too big for a module.`));let a=j(r);if(typeof a==`string`)throw Error(i(`That isn't a rules package: {why}`,{why:a}));return r}function q({draft:e}){let t=(0,S.useMemo)(()=>M(e.source),[e.source]),n=x(e=>e.error),r=c(e=>e.session!==null),a=[...t,...r&&n?[n]:[]];return a.length?(0,B.jsx)(`ul`,{className:`workshop-problems`,"aria-label":i(`Problems`),children:a.map(e=>(0,B.jsxs)(`li`,{children:[`⚠ `,e]},e))}):null}function J(e){let t=()=>c.getState().game.packages?.packages.some(t=>t.hash===e)??!1;if(!t())return u.getState().remove(e);let n=c.subscribe(()=>{t()||(n(),u.getState().remove(e))})}function Y(e){let t=u.getState().packages[e];t&&c.getState().dispatch({type:`game/packages`,app:f,system:{id:t.manifest.systems[0],builtIn:!1},packages:[g(t)]})}function X({save:e}){let t=c(e=>e.session!==null),[n,a]=(0,S.useState)(!1),o=async()=>{let t=await e(),n=t?u.getState().packages[t]:void 0;if(!n)return;a(!0);let i=c.getState();i.session&&(i.session.leave(),c.setState({session:null,role:null,scrub:null,selected:null,draft:null}));let o=n.manifest.systems[0];c.getState().start({role:`host`,mode:`hotseat`,name:localStorage.getItem(`open-battle:name`)??``,system:o}),Y(n.hash);let s=0,d=()=>{let{game:e,dispatch:t}=c.getState(),n=x.getState();if(n.status===`stopped`)return a(!1);if(n.status!==`on`||!l(o)||e.system!==o||r(e).length<2){s++<200?setTimeout(d,50):a(!1);return}m(()=>c.getState().game,t,crypto.randomUUID().slice(0,6)),c.getState().dispatch({type:`turn/next`}),a(!1)};d()};return(0,B.jsx)(`button`,{onClick:()=>void o(),disabled:n,children:i(n?`Setting up…`:t?`Restart the test table`:`Test table`)})}function Z(){let e=c(e=>e.session!==null),t=x(e=>e.status),r=c(e=>e.record),a=b(),o=(0,S.useMemo)(()=>e?d(r).filter(e=>e.kind===`line`&&!e.undone).slice(-12).reverse():[],[e,r]);return e?(0,B.jsxs)(`div`,{className:`workshop-table`,children:[(0,B.jsx)(`p`,{children:i(t===`on`?`Your rules are running.`:t===`starting`?`Starting your rules…`:`Your rules aren't running.`)}),(0,B.jsx)(`p`,{children:(0,B.jsx)(`button`,{onClick:v,children:n(a.length,`{n} table warning`,`{n} table warnings`,{n:a.length})})}),(0,B.jsx)(`h3`,{children:i(`Dice and log`)}),(0,B.jsx)(`ol`,{className:`workshop-log`,children:o.map(e=>(0,B.jsx)(`li`,{children:e.kind===`line`?e.text:``},e.key))})]}):(0,B.jsx)(`p`,{children:i(`Test table starts a game of your draft on this screen with each side's sample army. Every save reloads it there.`)})}function Q({draft:e}){let[t,n]=(0,S.useState)([]),[r,a]=(0,S.useState)(!1),o=async()=>{a(!0),n([]),await z(e.source,[1,2,3],e=>n(t=>[...t,e])),a(!1)};return(0,B.jsxs)(`div`,{className:`workshop-soak`,children:[(0,B.jsx)(`p`,{children:i(`The soak bot plays whole games of your draft with random legal moves, over pretend peers, and checks every table stays the same and nothing throws.`)}),(0,B.jsx)(`button`,{onClick:()=>void o(),disabled:r||M(e.source).length>0,children:i(r?`Playing…`:`Play 3 bot games`)}),(0,B.jsx)(`ul`,{children:t.map(e=>(0,B.jsx)(`li`,{className:e.ok?`ok`:`bad`,children:e.ok?i(`Game {seed}: fine, {steps} moves to round {round}.`,{seed:e.seed,steps:e.steps,round:e.round}):i(`Game {seed} went wrong: {why}`,{seed:e.seed,why:e.failures[0]??``})},e.seed))})]})}function $({draft:e}){let[t,n]=(0,S.useState)(null),[r,o]=(0,S.useState)(``),[s,c]=(0,S.useState)(!1),l=j(e.source);return(0,S.useEffect)(()=>{let t=!0;return crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e.source)).then(e=>{t&&n(Array.from(new Uint8Array(e)).map(e=>e.toString(16).padStart(2,`0`)).join(``))}),()=>{t=!1}},[e.source]),typeof l==`string`?(0,B.jsx)(`p`,{children:l}):(0,B.jsxs)(`div`,{className:`workshop-export`,children:[(0,B.jsxs)(`p`,{children:[i(`{name} {version}`,{name:l.name,version:l.version}),t&&(0,B.jsxs)(B.Fragment,{children:[` · `,(0,B.jsx)(`code`,{title:t,children:a(t)})]})]}),(0,B.jsx)(`button`,{className:`primary`,onClick:()=>{let t=document.createElement(`a`);t.href=URL.createObjectURL(new Blob([e.source],{type:`text/javascript`})),t.download=N(l),t.click(),setTimeout(()=>URL.revokeObjectURL(t.href),1e3)},children:i(`Download the package`)}),(0,B.jsx)(`p`,{className:`hint`,children:i(`Players load the file in Rules packages; peers check they have the same bytes by this fingerprint.`)}),(0,B.jsx)(`h3`,{children:i(`Share it in the gallery`)}),(0,B.jsxs)(`label`,{children:[i(`Where the file is hosted (a raw link)`),(0,B.jsx)(`input`,{type:`url`,value:r,placeholder:V,onChange:e=>o(e.target.value)})]}),(0,B.jsx)(`button`,{disabled:!t,onClick:()=>void navigator.clipboard.writeText(L(l,t,r)).then(()=>{c(!0),setTimeout(()=>c(!1),2e3)}),children:i(s?`Copied`:`Copy the pull request text`)}),` `,(0,B.jsx)(`a`,{href:I,target:`_blank`,rel:`noreferrer`,children:i(`Edit the gallery on GitHub`)})]})}function ee(){return(0,B.jsxs)(`div`,{className:`workshop-sdk`,children:[(0,B.jsx)(`p`,{children:i(`Everything a package can use. In the editor, type ctx. or view. for suggestions.`)}),(0,B.jsx)(`pre`,{children:C})]})}export{W as Workshop};