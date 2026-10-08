const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./syntax-CEL_Wvla.js","./dist-YYVtoirG.js","./dist-lgRNSFRF.js","./Editor-Du4UTELE.js","./react-DB-4Zxce.js","./jsx-runtime-BtH0gOTJ.js"])))=>i.map(i=>d[i]);
import{i as e,t}from"./react-DB-4Zxce.js";import{n}from"./showcase-B5C125pe.js";import{Ar as r,Dn as i,Mr as a,Or as o,_r as s,mr as c,pr as l,s as u,u as d}from"./store-bPnu4RP4.js";import{t as f}from"./gameLog-MO-nvBFb.js";import{t as p}from"./version-D5-rbpGs.js";import{t as m}from"./jsx-runtime-BtH0gOTJ.js";import{a as h}from"./lesson-B5zIzIVj.js";import{l as g,n as _,r as v}from"./index-inMCP7tf.js";import y from"./rift-lanterns-Kq_Pb0JD.js";import{a as b,i as x,l as S,u as C}from"./runtime-Cvjri7_y.js";import{s as w}from"./dist-lgRNSFRF.js";var T=e(t(),1),E=(e,t,n)=>({label:e,detail:t,info:n,type:`function`}),D=(e,t,n)=>({label:e,detail:t,info:n,type:`property`}),O=[D(`view`,`: GameView`,`The game as it stands: units, distances, line of sight.`),E(`roll`,`(dice, label?, unitId?, need?)`,'Roll dice with the host\'s dice, e.g. ctx.roll("3d6", "hits", unitId, 4). With `need`, each die of that score or more is a success.'),E(`note`,`(text)`,`A line in the game log.`),E(`ask`,`(player, question, options)`,`Ask a player to choose; the result is the option id.`),E(`run`,`(procedure, roles)`,`Run one of the system's data procedures to the end; the result says what each step rolled.`),E(`emit`,`(event)`,`Change the table with an event, e.g. { type: "model/wounds", id, woundsLost, destroyed }.`),E(`set`,`(key, value)`,`Remember a value for this player's package (read back from view.own[key]).`),E(`secret`,`(player, key, question, options)`,`A choice kept on the player's device; only a commitment goes on the table.`),E(`reveal`,`(player, key)`,`Have a player reveal a secret they committed.`)],k=[D(`round`,`: number`,`The battle round (0 while setting up).`),D(`phase`,`: string | null`,`The current phase's id.`),D(`activePlayer`,`: string | null`,`Whose turn it is.`),E(`unit`,`(id)`,`A unit by id.`),E(`units`,`(player?)`,`Every unit, or one player's.`),E(`distance`,`(a, b)`,`Closest distance between two units' bases, in the system's units.`),E(`visible`,`(from, to)`,`Whether a unit can see another.`),E(`inCover`,`(from, to)`,`Whether the target is in cover from the shooter.`),E(`arc`,`(of, other)`,`Which arc of a unit another is in (front, flank, rear), for ranked games.`),E(`engaged`,`(unitId)`,`Enemy units this one is engaged with.`),D(`own`,`: Record<string, unknown>`,`This player's package values (ctx.set).`),D(`state`,`: GameState`,`The whole game state, read-only.`)],A=[D(`id`,`manifest / module / action`,`A stable id: a package's must stay the same across versions.`),D(`name`,`manifest / action`,`What players see.`),D(`version`,`manifest / module`,`Semantic version, e.g. 0.1.0.`),D(`author`,`manifest`,`Who wrote it.`),D(`api`,`manifest / module`,`The SDK version: 1.`),D(`kind`,`manifest`,`"system" for a whole game, "extension" for additions to one.`),D(`systems`,`manifest`,`The system ids it brings or changes.`),D(`requires`,`manifest`,`Other packages it needs.`),D(`adds`,`manifest`,`One line on what it adds, shown before a player trusts it.`),D(`system`,`module`,`The rules as data: characteristics, dice, the turn (src/core/content/schema.ts).`),D(`app`,`module`,`The app glue: sample armies, the table layout, rank rules, a side panel.`),D(`actions`,`module`,`Code actions: buttons on a unit card or for a player.`),D(`procedures`,`module`,`Named generator procedures, run by data or by ctx.run.`),D(`hooks`,`module`,`Turn hooks: phaseStart, phaseEnd, roundStart, activationEnd.`),D(`functions`,`module`,`Pure functions data rules can call.`),D(`checks`,`module`,`(view) => warnings for the table warnings panel.`),D(`by`,`action`,`"unit" or "player".`),D(`phases`,`action`,`Phase ids it's offered in (an alternate's id for activations).`),E(`available`,`(view, actor)`,`true, or why not.`),E(`targets`,`(view, actor)`,`The targets to pick from: { unitId, label }.`),E(`run`,`function* (ctx, args)`,`What it does: yield ctx commands.`),E(`sample`,`(seat)`,`The test table's army for a seat.`),E(`layout`,`(table)`,`Terrain, objectives and deployment zones.`),E(`sidePanel`,`(view)`,`A panel of lines and buttons, or null.`),D(`armies`,`app`,`Every sample army players pick from, one per faction.`),D(`missions`,`app`,`Missions picked at setup: zones, objectives and scoring.`),D(`templateCategory`,`app`,`What each terrain template counts as, e.g. { Woods: "cover" }.`),D(`phaseStart`,`hooks`,`{ [phaseId]: function* (ctx) }`),D(`phaseEnd`,`hooks`,`{ [phaseId]: function* (ctx) }`),E(`roundStart`,`function* (ctx)`,`At the start of each round.`),E(`activationEnd`,`function* (ctx)`,`When a unit's activation ends.`),w(`{
  id: "\${id}",
  name: "\${Name}",
  by: "unit",
  phases: ["\${phase}"],
  available: (view, actor) => true,
  targets: (view, actor) => [],
  run: function* (ctx, args) {
    yield ctx.note("\${Name}");
  },
}`,{label:`action`,detail:`snippet`,info:`A code action on a unit card.`,type:`keyword`}),w('function* ${name}(ctx, args) {\n  const roll = yield ctx.roll("${2d6}", "${label}");\n  ${}\n}',{label:`procedure`,detail:`snippet`,info:`A generator procedure: yield commands, read their results.`,type:`keyword`}),w('{ kind: "phase", id: "${id}", name: "${Name}" }',{label:`phase`,detail:`snippet`,info:`A phase in the turn.`,type:`keyword`}),w('{ id: "${id}", name: "${Name}", of: "model", type: "number" }',{label:`characteristic`,detail:`snippet`,info:`A stat on each model's profile.`,type:`keyword`}),w(`{
  id: "\${id}",
  name: "\${Name}",
  summary: "\${What to do}",
  setup: (table) => ({ zones: [], objectives: [{ id: "middle", position: { x: 0, y: 0 } }] }),
  scoring: [
    {
      id: "\${hold}",
      name: "\${Held}",
      at: { roundEnd: true },
      suggest: (game, seat) => ({ vp: 1, why: "\${why}" }),
    },
  ],
}`,{label:`mission`,detail:`snippet`,info:`A mission: setup and scoring.`,type:`keyword`}),w('{ template: "${Ruin}", id: "${id}", position: { x: ${0}, y: ${0} }, facing: 0 }',{label:`terrain`,detail:`snippet`,info:`A terrain piece from a template (Ruin, Small ruin, Tall ruin, Container, Woods, Barricade, Crater, Hill).`,type:`keyword`}),w('look: { shape: "${trooper}", color: "${#8a6bb8}" }',{label:`look`,detail:`snippet`,info:`A model's stand-in figure: trooper, brute, robed, beast, walker, drone or vehicle.`,type:`keyword`}),w('(view) => [{ unitId: ${id}, message: "${what is wrong}", severity: "warning" }]',{label:`check`,detail:`snippet`,info:`A table warning.`,type:`keyword`})];function j(e){let t=e.matchBefore(/\b(ctx|view)\.\w*$/);if(t){let e=t.text.indexOf(`.`);return{from:t.from+e+1,options:t.text.startsWith(`ctx`)?O:k,validFor:/^\w*$/}}let n=e.matchBefore(/\w+$/);return!n&&!e.explicit||n&&e.state.sliceDoc(n.from-1,n.from)===`.`?null:{from:n?.from??e.pos,options:A,validFor:/^\w*$/}}var M=null,N=!1,ee=1,P=new Map;function te(){if(M||N)return M;try{M=new Worker(new URL(new URL(`typesWorker-Zi31zaJg.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`workshop-types`})}catch{return N=!0,null}return M.onmessage=e=>{P.get(e.data.id)?.(e.data.result),P.delete(e.data.id)},M.onerror=()=>{N=!0,M?.terminate(),M=null;for(let e of P.values())e(null);P.clear()},M}function F(e){let t=te();if(!t)return Promise.resolve(null);let n=ee++;return new Promise(r=>{P.set(n,e=>r(e)),t.postMessage({...e,id:n})})}var I={problems:async e=>await F({t:`problems`,source:e})??[],hover:(e,t)=>F({t:`hover`,source:e,pos:t}),complete:async(e,t)=>await F({t:`complete`,source:e,pos:t})??[],detail:(e,t,n)=>F({t:`detail`,source:e,pos:t,name:n}),available:()=>!N},ne=`import type { GameSystem, Id } from "../core/content/schema";
import type { GameState, Objective, Zone } from "../core/types";
import type { GameEvent } from "../core/actions";
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
  /** The button's text for this unit, when it says more than \`name\` ("Use Marsh Lantern (one use)"). */
  label?(view: GameView, actor: Actor): string;
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
  /** Between two units or models (ids of either), in the system's distance units. */
  distance(a: Id, b: Id): number;
  /** Whether any model of \`from\` sees any model of \`to\` (unit or model ids). */
  visible(from: Id, to: Id): boolean;
  /** Whether \`to\` is in cover from \`from\` (unit or model ids): a model in cover terrain, or seen through it. */
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
  | { cmd: "emit"; event: GameEvent }
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
  /**
   * Change the table with one of the game's events, e.g.
   * \`{ type: "model/wounds", id, woundsLost, destroyed }\`: the type names
   * which, and each takes its own fields.
   */
  emit(event: GameEvent): Command;
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
  /** The test table's (and a demo's) army for a seat. */
  sample(seat: 0 | 1): unknown;
  /**
   * Every sample army a player can pick (one per faction), shaped like
   * \`sample\`'s. Without it, players pick from the two \`sample\` gives.
   */
  armies?: unknown[];
  /**
   * The starting table. A terrain entry can name one of the app's terrain
   * templates instead of listing its solids: \`{ template: "Ruin", id,
   * position, facing?, category? }\` (templates: "Ruin", "Small ruin", "Tall
   * ruin", "Container", "Woods", "Barricade", "Crater", "Hill").
   */
  layout(table: GameState["table"]): unknown;
  /**
   * Missions players pick from at setup. They run in the sandbox: \`setup\`
   * once for the system's default table (scaled to the table played on), and
   * \`suggest\` as the game goes, its answers handed to the app.
   */
  missions?: Mission[];
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
`,re=`// A starter game for the module workshop: a skirmish game, model by model.
// Each player in turn moves, then fights. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// Everything a package can use is in the SDK tab, on the right; in the editor,
// type ctx. or view. for suggestions.

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

/** The rules as data: characteristics, dice and the turn (the SDK tab lists the keys). */
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
`,ie=`// A starter game for the module workshop: rank-and-flank regiments that move
// as blocks with a facing (wheel, reform, turn, march). Each player in turn
// moves, then the blocks in contact clash. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// Everything a package can use is in the SDK tab, on the right; in the editor,
// type ctx. or view. for suggestions.

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

/** The rules as data: characteristics, dice and the turn (the SDK tab lists the keys). */
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
  const files = me.formation?.kind === "ranked" ? me.formation.files : 5;
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
`,ae=`// A starter game for the module workshop: alternating activations. Players
// take turns activating one unit at a time; an activated unit may move and
// shoot. The round ends when every unit has gone. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// Everything a package can use is in the SDK tab, on the right; in the editor,
// type ctx. or view. for suggestions.

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

/** The rules as data: characteristics, dice and the turn (the SDK tab lists the keys). */
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
`,L=`open-battle:workshop`;function oe(){try{let e=JSON.parse(localStorage.getItem(L)??`null`);if(e&&Array.isArray(e.drafts))return e}catch{}return{drafts:[],current:null}}function se(e,t){try{localStorage.setItem(L,JSON.stringify({drafts:e,current:t}))}catch{}}function ce(e){return{id:crypto.randomUUID().slice(0,8),source:e,updated:Date.now()}}function R(e){let t=s(e);return`error`in t?t.error:t.manifest}function z(e){let t=R(e);if(typeof t==`string`)return[t];let n=[];return t.kind!==`system`&&n.push(`The workshop tests whole games: set manifest.kind to "system".`),t.systems[0]||n.push(`Name the game's system id in manifest.systems.`),/export\s+default\b/.test(e)||n.push(`Export the game: export default { module }.`),n}function le(e){return`${e.id.replace(/[^\w.-]+/g,`-`)}-${e.version}.js`}var B=`https://github.com/pwestling/Web40k`,V=`${B}/blob/main/docs/community-modules.md`,ue=`${B}/edit/main/docs/community-modules.md`;function de(e,t,n){let r=n||`<the module's raw URL>`;return[`## Add ${e.name} ${e.version} to the community modules`,``,e.adds??``,``,`Row for docs/community-modules.md:`,``,"```",`| [${e.name}](${r}) | ${e.version} | ${e.author??``} | ${e.systems.join(`, `)} | ${e.adds??``} | \`${t.slice(0,16)}\` |`,"```",``,`- Package id: \`${e.id}\` (kind: ${e.kind})`,`- SHA-256: \`${t}\``,`- Tested in the module workshop: the test table and the soak bot.`,`- No Games Workshop text, names or stats in the file.`].join(`
`)}var fe=12e4;async function H(e,t,n,r){let i=null,o;try{let e=(await a(async()=>{let{default:e}=await import(`./_virtual_soak-worker-dYo31o1S.js`);return{default:e}},[],import.meta.url)).default;o=await b.start(e,e=>i=e)}catch(e){let r=e instanceof Error?e.message:String(e);for(let e of t)n({seed:e,ok:!1,failures:[r],steps:0,round:0,finished:!1});return}try{for(let a of t)try{n(await o.call({t:`soak`,source:e,seed:a,...r===void 0?{}:{untilRound:r}},fe))}catch(e){if(n({seed:a,ok:!1,failures:[i??(e instanceof Error?e.message:String(e))],steps:0,round:0,finished:!1}),i)return}}finally{o.stop()}}var U=null;async function W(e){U??=(async()=>{let e=(await a(async()=>{let{default:e}=await import(`./_virtual_soak-worker-dYo31o1S.js`);return{default:e}},[],import.meta.url)).default;return b.start(e,()=>U=null)})();try{return await(await U).call({t:`check`,source:e},pe)}catch(e){throw U=null,e}}var pe=5e3;function me(e,t){let n=(/^system\.([\w.[\]]+)/.exec(t)?.[1])?.replace(/\[\d+\]/g,``).split(`.`).at(-1);if(!n)return null;let r=e.search(/\bconst\s+system\b|\bsystem\s*[:=]\s*{/),i=e.slice(Math.max(0,r)).search(RegExp(`\\b${n}\\s*:`));return i<0?null:e.slice(0,Math.max(0,r)+i).split(`
`).length}function he(e){let t=[];for(let n of e)n.ok===!1&&(n.id===`code`?t.push(n.text):n.id===`types`?t.push(r(n.count??1,`{n} type problem`,`{n} type problems`)):n.id===`load`?t.push(o(`it doesn't load`)):t.push(o(`the bot game went wrong`)));return t.join(`, `)}var G=2,K=(e,t)=>e.slice(0,t).split(`
`).length;function q(e,t){let n=/line (\d+)/.exec(t);return n?Number(n[1]):me(e,t)}async function ge(e,t){let n=[],i=()=>t([...n]),s=()=>({ok:n.every(e=>e.ok!==!1),source:e,steps:n,summary:he(n)}),c=z(e),{syntaxError:l}=await a(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),u=l(e);if(c.length||u)return n.push({id:`code`,ok:!1,text:c[0]??o(`The code doesn't parse at line {line}, column {column}.`,u),line:u?.line??null}),s();let[d,f]=await Promise.all([I.available()?I.problems(e):Promise.resolve(null),W(e).then(e=>e.errors[0]?.error??null,e=>e instanceof Error?e.message:String(e))]),p=d?.filter(e=>e.severity===`error`)??[];if(n.push(d===null?{id:`types`,ok:null,text:o(`Types: the type checker isn't available here.`),line:null}:p.length?{id:`types`,ok:!1,text:r(p.length,`Types: {n} problem. Line {line}: {message}`,`Types: {n} problems. The first, line {line}: {message}`,{line:K(e,p[0].from),message:p[0].message}),line:K(e,p[0].from),count:p.length}:{id:`types`,ok:!0,text:o(`Types: everything matches the SDK.`),line:null}),n.push(f?{id:`load`,ok:!1,text:o(`Loading: {why}`,{why:f}),line:q(e,f)}:{id:`load`,ok:!0,text:o(`Loading: it loads, and its system has the right shape.`),line:null}),i(),f)return n.push({id:`soak`,ok:null,text:o(`Bot game: not played, since it doesn't load.`),line:null}),s();let m=null;await H(e,[1],e=>m=e,G);let h=m;return n.push(h?h.ok?{id:`soak`,ok:!0,text:h.finished?o(`Bot game: played to the end in {steps} moves.`,{steps:h.steps}):o(`Bot game: {rounds} rounds in {steps} moves, with nothing wrong.`,{rounds:G,steps:h.steps}),line:null}:{id:`soak`,ok:!1,text:o(`Bot game: {why}`,{why:h.failures[0]??``}),line:q(e,h.failures[0]??``)}:{id:`soak`,ok:!1,text:o(`Bot game: it didn't report back.`),line:null}),s()}var J=m(),Y=`https://`,_e=(0,T.lazy)(()=>a(()=>import(`./Editor-Du4UTELE.js`).then(e=>({default:e.Editor})),__vite__mapDeps([3,4,5,2,1]),import.meta.url)),ve=[{id:`skirmish`,source:re,name:()=>o(`Skirmish`),what:()=>o(`Model by model: move, then fight.`)},{id:`ranked`,source:ie,name:()=>o(`Ranked`),what:()=>o(`Regiment blocks that wheel and clash.`)},{id:`activations`,source:ae,name:()=>o(`Alternating activations`),what:()=>o(`Players take turns activating one unit each.`)},{id:`rift-lanterns`,source:y,name:()=>`Rift Lanterns`,what:()=>o(`A finished game of ours to take apart: four warbands, three missions.`)}];function ye(){let[{drafts:e,current:t},n]=(0,T.useState)(oe),r=e.find(e=>e.id===t)??null,i=v(e=>e.folded),s=v(e=>e.link),c=u(e=>e.session!==null),[d,f]=(0,T.useState)(`table`),[p,m]=(0,T.useState)(null),[h,g]=(0,T.useState)(null),[y,b]=(0,T.useState)(null),[x,S]=(0,T.useState)(null),C=async()=>{if(!r||x)return;b(null),S([]);let e=await ge(r.source,S);S(null),b(e),g(e.steps.find(e=>e.ok===!1)?.line??null)},w=(e,t)=>{se(e,t),n({drafts:e,current:t})},E=t=>{let n=ce(t);w([...e,n],n.id)},D=t=>{r&&(h!==null&&g(null),w(e.map(e=>e.id===r.id?{...e,source:t,updated:Date.now()}:e),r.id))},O=()=>{if(!r||!confirm(o(`Delete this draft? This can't be undone.`)))return;let t=e.filter(e=>e.id!==r.id);w(t,t.at(-1)?.id??null)};(0,T.useEffect)(()=>{s&&(v.setState({link:null}),X(s).then(e=>{E(e),m({text:o(`Opened from {url}. Read it before you test it: saving runs its code in the sandbox.`,{url:s}),bad:!1})},e=>m({text:e.message,bad:!0})))},[s]);let k=(e,t=null)=>{m({text:e,bad:!0}),g(t)},A=async()=>{if(!r)return null;let t=r.source,n=z(t);if(n.length)return k(n[0]),null;let{syntaxError:i}=await a(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),s=i(t);if(s)return k(o(`Not saved: the code doesn't parse at line {line}, column {column}.`,s),s.line),null;let c;try{c=await W(t)}catch(e){return k(o(`Not saved: your rules didn't load: {why}`,{why:e instanceof Error?e.message:String(e)})),null}let d=c.errors[0]?.error;if(d)return k(o(`Not saved: your rules didn't load: {why}`,{why:d}),q(t,d)),null;g(null);let f=l.getState(),p=await f.add(new TextEncoder().encode(t),{own:!0});if(!p.ok)return k(p.error),null;f.trust(p.pkg.hash,!0),r.saved&&r.saved!==p.pkg.hash&&f.packages[r.saved]?.own&&Z(r.saved),w(e.map(e=>e.id===r.id?{...e,saved:p.pkg.hash}:e),r.id);let h=Ce(c);we(h);let _=p.pkg.manifest.systems[0],v=u.getState().game;if(u.getState().session&&v.packages?.system?.id===_){if(v.packages.packages.some(e=>e.hash===p.pkg.hash))return m({text:o(`Saved. Nothing changed for the test table.`),bad:!1}),p.pkg.hash;$(p.pkg.hash);let e=await Ee();e?k(o(`Saved, but your rules didn't load on the test table: {why}`,{why:e}),q(t,e)):m({text:Q.table!==null&&h!==Q.table?o(`Saved and reloaded. The sample armies, missions or table changed: restart the test table to play with them.`):o(`Saved and reloaded onto the test table.`),bad:!1})}else m({text:o(`Saved.`),bad:!1});return p.pkg.hash};if(i&&c)return(0,J.jsx)(`button`,{className:`workshop-tab`,onClick:()=>v.setState({folded:!1}),children:o(`Workshop`)});let j=r?R(r.source):null;return(0,J.jsxs)(`section`,{className:`workshop${c?` over-table`:``}`,role:c?`complementary`:`dialog`,"aria-label":o(`Module workshop`),children:[(0,J.jsxs)(`header`,{className:`workshop-head`,children:[(0,J.jsx)(`h2`,{children:o(`Module workshop`)}),e.length>0&&(0,J.jsx)(`select`,{"aria-label":o(`Draft`),value:t??``,onChange:t=>w(e,t.target.value),children:e.map(e=>{let t=R(e.source);return(0,J.jsx)(`option`,{value:e.id,children:typeof t==`string`?o(`Untitled draft`):`${t.name} ${t.version}`},e.id)})}),(0,J.jsx)(`span`,{className:`spacer`}),c&&(0,J.jsxs)(`button`,{onClick:()=>v.setState({folded:!0}),title:o(`Fold the workshop to the side`),children:[`⇥ `,o(`Table`)]}),(0,J.jsx)(`button`,{onClick:_,"aria-label":o(`Close the workshop`),children:`✕`})]}),r?(0,J.jsxs)(`div`,{className:`workshop-body`,children:[(0,J.jsxs)(`div`,{className:`workshop-code`,children:[(0,J.jsxs)(`div`,{className:`workshop-tools`,children:[(0,J.jsx)(`button`,{className:`primary`,onClick:()=>void A(),title:o(`Save (Ctrl+S)`),children:o(`Save`)}),(0,J.jsx)(De,{save:A}),(0,J.jsx)(`button`,{onClick:()=>void C(),disabled:!!x,title:o(`Check the types, load it, and let a bot play two rounds`),children:o(x?`Checking…`:`Check`)}),(0,J.jsx)(`span`,{className:`spacer`}),(0,J.jsx)(`button`,{onClick:()=>w(e,null),children:o(`New draft`)}),(0,J.jsx)(`button`,{onClick:O,children:o(`Delete`)})]}),p&&(0,J.jsx)(`p`,{className:`workshop-note${p.bad?` bad`:``}`,role:p.bad?`alert`:`status`,children:p.text}),(x||y)&&(0,J.jsx)(xe,{steps:x??y.steps,verdict:x?null:y,stale:!!y&&y.source!==r.source,onClose:()=>b(null)}),(0,J.jsx)(Se,{draft:r}),(0,J.jsx)(T.Suspense,{fallback:(0,J.jsx)(`div`,{className:`workshop-editor`,children:o(`Loading the editor…`)}),children:(0,J.jsx)(_e,{doc:r.source,onChange:D,onSave:()=>void A(),label:o(`The package's code`),mark:h})})]}),(0,J.jsxs)(`aside`,{className:`workshop-side`,children:[(0,J.jsx)(`div`,{className:`tabs`,role:`tablist`,children:[[`table`,o(`Test table`)],[`soak`,o(`Soak bot`)],[`export`,o(`Export`)],[`sdk`,o(`SDK`)]].map(([e,t])=>(0,J.jsx)(`button`,{role:`tab`,"aria-selected":d===e,onClick:()=>f(e),children:t},e))}),d===`table`&&(0,J.jsx)(Oe,{}),d===`soak`&&(0,J.jsx)(ke,{draft:r}),d===`export`&&typeof j!=`string`&&j&&(0,J.jsx)(Ae,{draft:r}),d===`export`&&typeof j==`string`&&(0,J.jsx)(`p`,{children:j}),d===`sdk`&&(0,J.jsx)(je,{})]})]}):(0,J.jsx)(be,{onPick:E})]})}function be({onPick:e}){let[t,n]=(0,T.useState)(``),[r,i]=(0,T.useState)(null);return(0,J.jsxs)(`div`,{className:`workshop-start`,children:[(0,J.jsx)(`p`,{children:o(`Write a whole game as one JavaScript file: its rules as data, with code where data won't do. Start from a template; the test table plays it as you go.`)}),(0,J.jsx)(`div`,{className:`workshop-templates`,children:ve.map(t=>(0,J.jsxs)(`button`,{className:`workshop-template`,onClick:()=>e(t.source),children:[(0,J.jsx)(`strong`,{children:t.name()}),(0,J.jsx)(`span`,{children:t.what()})]},t.id))}),(0,J.jsxs)(`form`,{className:`workshop-link`,onSubmit:n=>{n.preventDefault(),i(null),X(t).then(e,e=>i(e.message))},children:[(0,J.jsxs)(`label`,{children:[o(`Open from a link`),(0,J.jsx)(`input`,{type:`url`,value:t,placeholder:Y,onChange:e=>n(e.target.value),required:!0})]}),(0,J.jsx)(`button`,{type:`submit`,children:o(`Open`)}),r&&(0,J.jsx)(`p`,{className:`error`,children:r})]}),(0,J.jsxs)(`p`,{children:[(0,J.jsx)(`a`,{href:V,target:`_blank`,rel:`noreferrer`,children:o(`Community modules`)}),` · `,(0,J.jsx)(`a`,{href:`${V.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:o(`How packages work`)})]})]})}async function X(e){let t=e.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,`https://raw.githubusercontent.com/$1/`),n;try{n=await fetch(t)}catch{throw Error(o(`Couldn't fetch that link (it may not allow other sites to read it).`))}if(!n.ok)throw Error(o(`That link answered {status}.`,{status:n.status}));let r=await n.text();if(r.length>1048576)throw Error(o(`That's too big for a module.`));let i=R(r);if(typeof i==`string`)throw Error(o(`That isn't a rules package: {why}`,{why:i}));return r}function xe({steps:e,verdict:t,stale:n,onClose:r}){let i=t?t.ok?o(`Ready to share: nothing wrong found.`):o(`Not ready yet: {summary}`,{summary:t.summary}):o(`Checking: types, loading, then a short bot game…`);return(0,J.jsxs)(`div`,{className:`workshop-check${t?t.ok?` ok`:` bad`:``}`,role:`status`,"aria-live":`polite`,children:[(0,J.jsxs)(`div`,{className:`row spread`,children:[(0,J.jsxs)(`strong`,{children:[t?t.ok?`✓ `:`✗ `:``,i]}),t&&(0,J.jsx)(`button`,{className:`quiet`,onClick:r,title:o(`Hide`),children:`✕`})]}),n&&(0,J.jsx)(`p`,{className:`muted small`,children:o(`The draft has changed since: check again.`)}),(0,J.jsx)(`ul`,{children:e.map(e=>(0,J.jsxs)(`li`,{className:e.ok===null?`skip`:e.ok?`ok`:`bad`,children:[e.ok===null?`–`:e.ok?`✓`:`✗`,` `,e.text]},e.id))})]})}function Se({draft:e}){let t=(0,T.useMemo)(()=>z(e.source),[e.source]),n=x(e=>e.error),r=u(e=>e.session!==null),i=[...t,...r&&n?[n]:[]];return i.length?(0,J.jsx)(`ul`,{className:`workshop-problems`,"aria-label":o(`Problems`),children:i.map(e=>(0,J.jsxs)(`li`,{children:[`⚠ `,e]},e))}):null}function Z(e){let t=()=>u.getState().game.packages?.packages.some(t=>t.hash===e)??!1;if(!t())return l.getState().remove(e);let n=u.subscribe(()=>{t()||(n(),l.getState().remove(e))})}function Ce(e){let t=e.packages[0]?.provides?.app;return JSON.stringify(t?[t.samples,t.armies,t.missions,t.layout]:null)}var Q={table:null,last:null},we=e=>void(Q.last=e),Te=()=>void(Q.table=Q.last);function Ee(){return new Promise(e=>{let t=x.getState().status===`starting`,n=t=>{r(),clearTimeout(i),e(t)},r=x.subscribe(e=>{e.status===`starting`?t=!0:t&&n(e.status===`on`?e.error:e.error??o(`the rules stopped`))}),i=setTimeout(()=>n(null),1e4)})}function $(e){let t=l.getState().packages[e];t&&u.getState().dispatch({type:`game/packages`,app:p,system:{id:t.manifest.systems[0],builtIn:!1},packages:[g(t)]})}function De({save:e}){let t=u(e=>e.session!==null),[r,a]=(0,T.useState)(!1),s=async()=>{let t=await e();Te();let r=t?l.getState().packages[t]:void 0;if(!r)return;a(!0);let o=u.getState();o.session&&(o.session.leave(),u.setState({session:null,role:null,scrub:null,selected:null,draft:null}));let s=r.manifest.systems[0];u.getState().start({role:`host`,mode:`hotseat`,name:localStorage.getItem(`open-battle:name`)??``,system:s}),$(r.hash);let c=0,f=()=>{let{game:e,dispatch:t}=u.getState(),r=x.getState();if(r.status===`stopped`)return a(!1);if(r.status!==`on`||!d(s)||e.system!==s||i(e).length<2){c++<200?setTimeout(f,50):a(!1);return}n.initial=u.getState().record.initial,h(()=>u.getState().game,t,crypto.randomUUID().slice(0,6)),u.getState().dispatch({type:`turn/next`}),a(!1)};f()};return(0,J.jsx)(`button`,{onClick:()=>void s(),disabled:r,children:o(r?`Setting up…`:t?`Restart the test table`:`Test table`)})}function Oe(){let e=u(e=>e.session!==null),t=x(e=>e.status),n=x(e=>e.error),i=u(e=>e.record),a=C(),s=(0,T.useMemo)(()=>e?f(i).filter(e=>e.kind===`line`&&!e.undone).slice(-12).reverse():[],[e,i]);return e?(0,J.jsxs)(`div`,{className:`workshop-table`,children:[(0,J.jsxs)(`p`,{className:n&&t!==`starting`?`bad`:void 0,children:[o(t===`on`&&!n?`Your rules are running.`:t===`starting`?`Starting your rules…`:`Your rules aren't running.`),n&&t!==`starting`&&(0,J.jsxs)(J.Fragment,{children:[` `,n]})]}),(0,J.jsx)(`p`,{children:(0,J.jsx)(`button`,{onClick:S,children:r(a.length,`{n} table warning`,`{n} table warnings`,{n:a.length})})}),(0,J.jsx)(`h3`,{children:o(`Dice and log`)}),(0,J.jsx)(`ol`,{className:`workshop-log`,children:s.map(e=>(0,J.jsx)(`li`,{children:e.kind===`line`?e.text:``},e.key))})]}):(0,J.jsx)(`p`,{children:o(`Test table starts a game of your draft on this screen with each side's sample army. Every save reloads it there.`)})}function ke({draft:e}){let[t,n]=(0,T.useState)([]),[r,i]=(0,T.useState)(!1),a=async()=>{i(!0),n([]),await H(e.source,[1,2,3],e=>n(t=>[...t,e])),i(!1)};return(0,J.jsxs)(`div`,{className:`workshop-soak`,children:[(0,J.jsx)(`p`,{children:o(`The soak bot plays whole games of your draft with random legal moves, over pretend peers, and checks every table stays the same and nothing throws.`)}),(0,J.jsx)(`button`,{onClick:()=>void a(),disabled:r||z(e.source).length>0,children:o(r?`Playing…`:`Play 3 bot games`)}),(0,J.jsx)(`ul`,{children:t.map(e=>(0,J.jsx)(`li`,{className:e.ok?`ok`:`bad`,children:e.ok?e.finished?o(`Game {seed}: fine, played to the end in {steps} moves.`,{seed:e.seed,steps:e.steps}):o(`Game {seed}: fine for {steps} moves, stopped in round {round}.`,{seed:e.seed,steps:e.steps,round:e.round}):o(`Game {seed} went wrong: {why}`,{seed:e.seed,why:e.failures[0]??``})},e.seed))})]})}function Ae({draft:e}){let[t,n]=(0,T.useState)(null),[r,i]=(0,T.useState)(``),[a,s]=(0,T.useState)(!1),l=R(e.source);return(0,T.useEffect)(()=>{let t=!0;return crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e.source)).then(e=>{t&&n(Array.from(new Uint8Array(e)).map(e=>e.toString(16).padStart(2,`0`)).join(``))}),()=>{t=!1}},[e.source]),typeof l==`string`?(0,J.jsx)(`p`,{children:l}):(0,J.jsxs)(`div`,{className:`workshop-export`,children:[(0,J.jsxs)(`p`,{children:[o(`{name} {version}`,{name:l.name,version:l.version}),t&&(0,J.jsxs)(J.Fragment,{children:[` · `,(0,J.jsx)(`code`,{title:t,children:c(t)})]})]}),(0,J.jsx)(`button`,{className:`primary`,onClick:()=>{let t=document.createElement(`a`);t.href=URL.createObjectURL(new Blob([e.source],{type:`text/javascript`})),t.download=le(l),t.click(),setTimeout(()=>URL.revokeObjectURL(t.href),1e3)},children:o(`Download the package`)}),(0,J.jsx)(`p`,{className:`hint`,children:o(`Players load the file in Rules packages; peers check they have the same bytes by this fingerprint.`)}),(0,J.jsx)(`h3`,{children:o(`Share it in the gallery`)}),(0,J.jsx)(`p`,{className:`hint`,children:o(`To host it: make a gist at gist.github.com, paste the file in, save, and copy its Raw link. A file in a GitHub repository works too (its Raw button).`)}),(0,J.jsxs)(`label`,{children:[o(`Where the file is hosted (a raw link)`),(0,J.jsx)(`input`,{type:`url`,value:r,placeholder:Y,onChange:e=>i(e.target.value)})]}),(0,J.jsx)(`button`,{disabled:!t,onClick:()=>void navigator.clipboard.writeText(de(l,t,r)).then(()=>{s(!0),setTimeout(()=>s(!1),2e3)}),children:o(a?`Copied`:`Copy the pull request text`)}),` `,(0,J.jsx)(`a`,{href:ue,target:`_blank`,rel:`noreferrer`,children:o(`Edit the gallery on GitHub`)})]})}function je(){let e=(e,t)=>(0,J.jsxs)(J.Fragment,{children:[(0,J.jsx)(`h3`,{children:e}),(0,J.jsx)(`dl`,{className:`workshop-ref`,children:t.map(e=>(0,J.jsxs)(`div`,{children:[(0,J.jsx)(`dt`,{children:(0,J.jsxs)(`code`,{children:[e.label,e.detail&&e.detail!==`snippet`?` ${e.detail}`:``]})}),(0,J.jsx)(`dd`,{children:typeof e.info==`string`?e.info:``})]},e.label))})]});return(0,J.jsxs)(`div`,{className:`workshop-sdk`,children:[(0,J.jsx)(`p`,{children:o(`Everything a package can use. In the editor, type ctx. or view. for suggestions.`)}),e(o(`Commands a rule yields (ctx.)`),O),e(o(`The game as it stands (view.)`),k),e(o(`Keys and snippets`),A),(0,J.jsx)(`p`,{children:(0,J.jsx)(`a`,{href:`${V.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:o(`How packages work`)})}),(0,J.jsxs)(`details`,{children:[(0,J.jsx)(`summary`,{children:o(`The full types`)}),(0,J.jsx)(`pre`,{children:ne})]})]})}export{ye as Workshop,j as n,I as t};