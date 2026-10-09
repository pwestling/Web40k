const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./syntax-CEL_Wvla.js","./dist-YYVtoirG.js","./dist-lgRNSFRF.js","./Editor-BATcjN88.js","./rolldown-runtime-hePW80VL.js","./react-Cvdyeg_0.js","./jsx-runtime-NZYk81nU.js"])))=>i.map(i=>d[i]);
import{r as e}from"./rolldown-runtime-hePW80VL.js";import{d as t,f as n,h as r}from"./systemLabels-zzOevBto.js";import{t as i}from"./react-Cvdyeg_0.js";import{hr as a,jn as o,pr as s}from"./core-BDr3zgja.js";import{t as c}from"./preload-helper-BaNbYf_w.js";import{T as l,b as u}from"./store-CwPI8yVb.js";import{t as d}from"./gameLog-Doq0ZsOd.js";import{n as f}from"./files-CdfAAl3C.js";import{g as p,m}from"./riftLanterns-etmIAHzT.js";import{t as h}from"./jsx-runtime-NZYk81nU.js";import{r as g}from"./help-BGug-006.js";import{n as _}from"./showcase-BGlouo4h.js";import{c as v,l as y}from"./index-_V-WWblP.js";import b from"./brinewatch-DN2-OwGh.js";import x from"./rift-lanterns-DLDKmR7R.js";import{a as S,b as C,i as w,v as T}from"./TableWarnings-CMcUvVCp.js";import{s as E}from"./dist-lgRNSFRF.js";var D=e(i(),1),O=(e,t,n)=>({label:e,detail:t,info:n,type:`function`}),k=(e,t,n)=>({label:e,detail:t,info:n,type:`property`}),A=[k(`view`,`: GameView`,`The game as it stands: units, distances, line of sight.`),O(`roll`,`(dice, label?, unitId?, need?)`,'Roll dice with the host\'s dice, e.g. ctx.roll("3d6", "hits", unitId, 4). With `need`, each die of that score or more is a success.'),O(`note`,`(text)`,`A line in the game log.`),O(`ask`,`(player, question, options)`,`Ask a player to choose; the result is the option id.`),O(`run`,`(procedure, roles)`,`Run one of the system's data procedures to the end; the result says what each step rolled.`),O(`emit`,`(event)`,`Change the table with an event, e.g. { type: "model/wounds", id, woundsLost, destroyed }.`),O(`set`,`(key, value)`,`Remember a value for this player's package (read back from view.own[key]).`),O(`secret`,`(player, key, question, options)`,`A choice kept on the player's device; only a commitment goes on the table.`),O(`reveal`,`(player, key)`,`Have a player reveal a secret they committed.`)],j=[k(`round`,`: number`,`The battle round (0 while setting up).`),k(`phase`,`: string | null`,`The current phase's id.`),k(`activePlayer`,`: string | null`,`Whose turn it is.`),O(`unit`,`(id)`,`A unit by id.`),O(`units`,`(player?)`,`Every unit, or one player's.`),O(`distance`,`(a, b)`,`Closest distance between two units' bases, in the system's units.`),O(`visible`,`(from, to)`,`Whether a unit can see another.`),O(`inCover`,`(from, to)`,`Whether the target is in cover from the shooter.`),O(`arc`,`(of, other)`,`Which arc of a unit another is in (front, flank, rear), for ranked games.`),O(`engaged`,`(unitId)`,`Enemy units this one is engaged with.`),k(`own`,`: Record<string, unknown>`,`This player's package values (ctx.set).`),k(`state`,`: GameState`,`The whole game state, read-only.`)],M=[k(`id`,`manifest / module / action`,`A stable id: a package's must stay the same across versions.`),k(`name`,`manifest / action`,`What players see.`),k(`version`,`manifest / module`,`Semantic version, e.g. 0.1.0.`),k(`author`,`manifest`,`Who wrote it.`),k(`api`,`manifest / module`,`The SDK version: 1.`),k(`kind`,`manifest`,`"system" for a whole game, "extension" for additions to one.`),k(`systems`,`manifest`,`The system ids it brings or changes.`),k(`requires`,`manifest`,`Other packages it needs.`),k(`adds`,`manifest`,`One line on what it adds, shown before a player trusts it.`),k(`system`,`module`,`The rules as data: characteristics, dice, the turn (src/core/content/schema.ts).`),k(`app`,`module`,`The app glue: sample armies, the table layout, rank rules, a side panel.`),k(`actions`,`module`,`Code actions: buttons on a unit card or for a player.`),k(`procedures`,`module`,`Named generator procedures, run by data or by ctx.run.`),k(`hooks`,`module`,`Turn hooks: phaseStart, phaseEnd, roundStart, activationEnd.`),k(`functions`,`module`,`Pure functions data rules can call.`),k(`checks`,`module`,`(view) => warnings for the table warnings panel.`),k(`by`,`action`,`"unit" or "player".`),k(`phases`,`action`,`Phase ids it's offered in (an alternate's id for activations).`),O(`available`,`(view, actor)`,`true, or why not.`),O(`targets`,`(view, actor)`,`The targets to pick from: { unitId, label }.`),O(`run`,`function* (ctx, args)`,`What it does: yield ctx commands.`),O(`sample`,`(seat)`,`The test table's army for a seat.`),O(`layout`,`(table)`,`Terrain, objectives and deployment zones.`),O(`sidePanel`,`(view)`,`A panel of lines and buttons, or null.`),k(`armies`,`app`,`Every sample army players pick from, one per faction.`),k(`missions`,`app`,`Missions picked at setup: zones, objectives and scoring.`),k(`templateCategory`,`app`,`What each terrain template counts as, e.g. { Woods: "cover" }.`),k(`phaseStart`,`hooks`,`{ [phaseId]: function* (ctx) }`),k(`phaseEnd`,`hooks`,`{ [phaseId]: function* (ctx) }`),O(`roundStart`,`function* (ctx)`,`At the start of each round.`),O(`activationEnd`,`function* (ctx)`,`When a unit's activation ends.`),E(`{
  id: "\${id}",
  name: "\${Name}",
  by: "unit",
  phases: ["\${phase}"],
  available: (view, actor) => true,
  targets: (view, actor) => [],
  run: function* (ctx, args) {
    yield ctx.note("\${Name}");
  },
}`,{label:`action`,detail:`snippet`,info:`A code action on a unit card.`,type:`keyword`}),E('function* ${name}(ctx, args) {\n  const roll = yield ctx.roll("${2d6}", "${label}");\n  ${}\n}',{label:`procedure`,detail:`snippet`,info:`A generator procedure: yield commands, read their results.`,type:`keyword`}),E('{ kind: "phase", id: "${id}", name: "${Name}" }',{label:`phase`,detail:`snippet`,info:`A phase in the turn.`,type:`keyword`}),E('{ id: "${id}", name: "${Name}", of: "model", type: "number" }',{label:`characteristic`,detail:`snippet`,info:`A stat on each model's profile.`,type:`keyword`}),E(`{
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
}`,{label:`mission`,detail:`snippet`,info:`A mission: setup and scoring.`,type:`keyword`}),E('{ template: "${Ruin}", id: "${id}", position: { x: ${0}, y: ${0} }, facing: 0 }',{label:`terrain`,detail:`snippet`,info:`A terrain piece from a template (Ruin, Small ruin, Tall ruin, Container, Woods, Barricade, Crater, Hill).`,type:`keyword`}),E('look: { shape: "${trooper}", color: "${#8a6bb8}" }',{label:`look`,detail:`snippet`,info:`A model's stand-in figure: trooper, brute, robed, beast, walker, drone or vehicle.`,type:`keyword`}),E('(view) => [{ unitId: ${id}, message: "${what is wrong}", severity: "warning" }]',{label:`check`,detail:`snippet`,info:`A table warning.`,type:`keyword`})];function ee(e){let t=e.matchBefore(/\b(ctx|view)\.\w*$/);if(t){let e=t.text.indexOf(`.`);return{from:t.from+e+1,options:t.text.startsWith(`ctx`)?A:j,validFor:/^\w*$/}}let n=e.matchBefore(/\w+$/);return!n&&!e.explicit||n&&e.state.sliceDoc(n.from-1,n.from)===`.`?null:{from:n?.from??e.pos,options:M,validFor:/^\w*$/}}var N=null,P=!1,te=1,F=new Map;function ne(){if(N||P)return N;try{N=new Worker(new URL(new URL(`typesWorker-BpHEAGo2.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`workshop-types`})}catch{return P=!0,null}return N.onmessage=e=>{F.get(e.data.id)?.(e.data.result),F.delete(e.data.id)},N.onerror=()=>{P=!0,N?.terminate(),N=null;for(let e of F.values())e(null);F.clear()},N}function I(e){let t=ne();if(!t)return Promise.resolve(null);let n=te++;return new Promise(r=>{F.set(n,e=>r(e)),t.postMessage({...e,id:n})})}var L={problems:async e=>await I({t:`problems`,source:e})??[],hover:(e,t)=>I({t:`hover`,source:e,pos:t}),complete:async(e,t)=>await I({t:`complete`,source:e,pos:t})??[],detail:(e,t,n)=>I({t:`detail`,source:e,pos:t,name:n}),available:()=>!P},re=`import type { GameSystem, Id } from "../core/content/schema";
import type { GameState, Objective, Unit, Zone } from "../core/types";
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
  /** How the computer opponent (src/bot) should weigh this game, where its defaults don't fit. */
  bot?: BotTuning;
}

/**
 * Tuning for the computer opponent. It judges a table by victory points,
 * what the mission would score now, the army each side has left and how near
 * its units are to the objectives; a module can say more.
 */
export interface BotTuning {
  /** VP that a whole army is worth, for weighing models lost against points scored. */
  armyVp?: number;
  /** A unit's worth, when the sheet has no points. */
  unitValue?(state: GameState, unit: Unit): number;
  /**
   * Extra to add to the judgement, from \`seat\`'s side (a module's own sense
   * of what matters). \`view\` asks the table's geometry (sight, cover,
   * distance) as a module's actions do, for judging positions by them.
   */
  evaluate?(state: GameState, seat: number, view: GameView): number;
  /** Inches a unit moves in a straight move it makes by hand, when there's no move action. */
  moveInches?(state: GameState, unit: Unit): number;
  /** How much it fears enemies in reach of its units (default 0.3; 0 turns it off). */
  threat?: number;
  /**
   * What the whole-turn planner (#51) plays after its own turn: the enemy's
   * whole turn, greedily ("turn", the default), or only their guns ("shots").
   */
  planReply?: "turn" | "shots";
  /** Sharp's own weights for this game, over its defaults (Conquest: it looks further ahead at the mission). */
  sharp?: Partial<
    Record<"projectNext" | "projectLater" | "approach" | "contest" | "engage" | "threat" | "finish", number>
  >;
  /**
   * Height matters here (vantage from upper floors): the computer also tries
   * moving its units up onto the nearest floors and blocks it can reach,
   * climbing counted, and steps them down where a floor ends.
   */
  climbs?: boolean;
  /** Regiments turn to face where they march, or end facing the nearest enemy (Conquest: charges go at the front arc). */
  faceMoves?: boolean;
  /**
   * How many goes, each on its own dice, the game review (#63) plays out of
   * the moves it weighs closely (default 3); more where one go says little
   * (Conquest: a whole activation and the enemy's answer).
   */
  reviewPasses?: number;
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
  /**
   * At a real table (\`view.atTable\`, the table companion) nothing can be
   * measured, so the players say: yes/no questions asked before the action
   * starts, for this target. The answers reach \`run\` as \`args.told[id]\`; a
   * question with \`need\` answered no stops the action ("Can they see it?").
   */
  told?(view: GameView, actor: Actor, target: Id | undefined): TableQuestion[];
  /**
   * Action points it spends, in a game whose activations count them (the
   * alternate slot's \`actionsPerActivation\`, e.g. 2 a go): 1 when missing,
   * 0 for a free action. The engine refuses it when the unit has fewer left,
   * and the unit's go ends once they're all spent. A rule may spend more
   * by emitting \`{ type: "unit/status", id, key: "actionsTaken", value }\`.
   */
  cost?: number;
  run: CodeProcedure;
}

/** A yes/no question the players answer from their real table (see \`CodeAction.told\`). */
export interface TableQuestion {
  id: Id;
  question: string;
  /** Without a yes, the action can't be taken. */
  need?: boolean;
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
   * After a charge, for rules that react to how it went. Started with
   * \`{ unitId, kind, round, player }\` and: for a charge roll (a dice roll
   * labelled "charge" or "charge roll" for the unit), \`kind: "roll"\` and
   * \`roll\` (the total); for a charge move (core \`chargeFor\`: a block's charge
   * move, or models moved in a Charge phase), \`kind: "move"\`, \`landed\`
   * (whether it ended in contact) and, when it did, \`targetId\`.
   */
  charge?: CodeProcedure;
  /**
   * After a unit moves in the battle (dragged, or moved as a block; not set
   * up, and not before round 1), for rules that answer a move: a guard's
   * shot at a model that moves in its sight, or charging the move's cost to
   * the mover's action points. Started with \`{ unitId, round, player }\`.
   */
  moved?: CodeProcedure;
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
  /**
   * Played with real models on a real table (the table companion): the
   * positions aren't the table's, so \`distance\`, \`visible\` and \`inCover\` mean
   * nothing. Ask the players instead (\`CodeAction.told\`, \`ctx.ask\`).
   */
  atTable: boolean;
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
  /**
   * The game's rules in words (#47), for its rules page, its docs and its
   * print-and-play rules sheet, which add tables made from the game's own
   * data (armies, units, missions, the starter table). Light Markdown: a
   * line each, \`**bold**\`, \`- \` and \`1. \` list items, a blank line between
   * paragraphs.
   */
  rulebook?: Rulebook;
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
export type ScoringMoment =
  { phaseEnd: Id; fromRound?: number } | { roundEnd: true; fromRound?: number } | { gameEnd: true };

export interface ScoringRule {
  id: Id;
  name: string;
  at: ScoringMoment;
  /** The side's score at that moment, as the table stood then; null when it scores nothing. */
  suggest(game: GameState, seat: number): { vp: number; why: string } | null;
  /** At a real table (table companion), what to ask the player instead, the app working out the VP. */
  ask?: ScoreQuestion;
  /**
   * False when \`suggest\` measures nothing on the table (it counts units wiped out, say): a real
   * table can then use it as it is, instead of asking.
   */
  measures?: boolean;
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

/** A game's rules in words (PackageApp.rulebook). */
export interface Rulebook {
  intro: string;
  sections: { id: Id; title: string; text: string }[];
  /** The quick-reference card, a line each. */
  quickRef?: string[];
  /**
   * What the game calls its armies, units and objective markers, for the
   * headings and tables made from its data (Rift Lanterns' warbands, units
   * and lanterns when missing). \`reach\` is how near a model must be to hold
   * a marker, in inches, for the print-and-play gauge.
   */
  words?: {
    army: string;
    armies: string;
    unit: string;
    units: string;
    marker: string;
    markers: string;
    reach: number;
  };
  /** The starter map's colour for each of the game's terrain categories, over the built-in ones. */
  terrainColors?: Record<string, string>;
}
`,ie=`// A starter game for the module workshop: a skirmish game, model by model.
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
`,ae=`// A starter game for the module workshop: rank-and-flank regiments that move
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
`,oe=`// A starter game for the module workshop: alternating activations. Players
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
`,R=`open-battle:workshop`;function se(){try{let e=JSON.parse(localStorage.getItem(R)??`null`);if(e&&Array.isArray(e.drafts))return e}catch{}return{drafts:[],current:null}}function ce(e,t){try{localStorage.setItem(R,JSON.stringify({drafts:e,current:t}))}catch{}}function le(e){return{id:crypto.randomUUID().slice(0,8),source:e,updated:Date.now()}}function z(e){let t=r(e);return`error`in t?t.error:t.manifest}function B(e){let t=z(e);if(typeof t==`string`)return[t];let n=[];return t.kind!==`system`&&n.push(`The workshop tests whole games: set manifest.kind to "system".`),t.systems[0]||n.push(`Name the game's system id in manifest.systems.`),/export\s+default\b/.test(e)||n.push(`Export the game: export default { module }.`),n}function ue(e){return`${e.id.replace(/[^\w.-]+/g,`-`)}-${e.version}.js`}var V=`https://github.com/pwestling/Web40k`,H=`${V}/blob/main/docs/community-modules.md`,de=`${V}/edit/main/docs/community-modules.md`;function fe(e,t,n){let r=n||`<the module's raw URL>`;return[`## Add ${e.name} ${e.version} to the community modules`,``,e.adds??``,``,`Row for docs/community-modules.md:`,``,"```",`| [${e.name}](${r}) | ${e.version} | ${e.author??``} | ${e.systems.join(`, `)} | ${e.adds??``} | \`${t.slice(0,16)}\` |`,"```",``,`- Package id: \`${e.id}\` (kind: ${e.kind})`,`- SHA-256: \`${t}\``,`- Tested in the module workshop: the test table and the soak bot.`,`- No Games Workshop text, names or stats in the file.`].join(`
`)}var pe=12e4;async function U(e,t,n,r){let i=null,a;try{let e=(await c(async()=>{let{default:e}=await import(`./_virtual_soak-worker-DCCuiKde.js`);return{default:e}},[],import.meta.url)).default;a=await C.start(e,e=>i=e)}catch(e){let r=e instanceof Error?e.message:String(e);for(let e of t)n({seed:e,ok:!1,failures:[r],steps:0,round:0,finished:!1});return}try{for(let o of t)try{n(await a.call({t:`soak`,source:e,seed:o,...r===void 0?{}:{untilRound:r}},pe))}catch(e){if(n({seed:o,ok:!1,failures:[i??(e instanceof Error?e.message:String(e))],steps:0,round:0,finished:!1}),i)return}}finally{a.stop()}}var W=null;async function G(e){W??=(async()=>{let e=(await c(async()=>{let{default:e}=await import(`./_virtual_soak-worker-DCCuiKde.js`);return{default:e}},[],import.meta.url)).default;return C.start(e,()=>W=null)})();try{return await(await W).call({t:`check`,source:e},me)}catch(e){throw W=null,e}}var me=5e3;function he(e,t){let n=(/^system\.([\w.[\]]+)/.exec(t)?.[1])?.replace(/\[\d+\]/g,``).split(`.`).at(-1);if(!n)return null;let r=e.search(/\bconst\s+system\b|\bsystem\s*[:=]\s*{/),i=e.slice(Math.max(0,r)).search(RegExp(`\\b${n}\\s*:`));return i<0?null:e.slice(0,Math.max(0,r)+i).split(`
`).length}function ge(e){let t=[];for(let n of e)n.ok===!1&&(n.id===`code`?t.push(n.text):n.id===`types`?t.push(a(n.count??1,`{n} type problem`,`{n} type problems`)):n.id===`load`?t.push(s(`it doesn't load`)):t.push(s(`the bot game went wrong`)));return t.join(`, `)}var K=2,q=(e,t)=>e.slice(0,t).split(`
`).length;function J(e,t){let n=/line (\d+)/.exec(t);return n?Number(n[1]):he(e,t)}async function _e(e,t){let n=[],r=()=>t([...n]),i=()=>({ok:n.every(e=>e.ok!==!1),source:e,steps:n,summary:ge(n)}),o=B(e),{syntaxError:l}=await c(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),u=l(e);if(o.length||u)return n.push({id:`code`,ok:!1,text:o[0]??s(`The code doesn't parse at line {line}, column {column}.`,u),line:u?.line??null}),i();let[d,f]=await Promise.all([L.available()?L.problems(e):Promise.resolve(null),G(e).then(e=>e.errors[0]?.error??null,e=>e instanceof Error?e.message:String(e))]),p=d?.filter(e=>e.severity===`error`)??[];if(n.push(d===null?{id:`types`,ok:null,text:s(`Types: the type checker isn't available here.`),line:null}:p.length?{id:`types`,ok:!1,text:a(p.length,`Types: {n} problem. Line {line}: {message}`,`Types: {n} problems. The first, line {line}: {message}`,{line:q(e,p[0].from),message:p[0].message}),line:q(e,p[0].from),count:p.length}:{id:`types`,ok:!0,text:s(`Types: everything matches the SDK.`),line:null}),n.push(f?{id:`load`,ok:!1,text:s(`Loading: {why}`,{why:f}),line:J(e,f)}:{id:`load`,ok:!0,text:s(`Loading: it loads, and its system has the right shape.`),line:null}),r(),f)return n.push({id:`soak`,ok:null,text:s(`Bot game: not played, since it doesn't load.`),line:null}),i();let m=null;await U(e,[1],e=>m=e,K);let h=m;return n.push(h?h.ok?{id:`soak`,ok:!0,text:h.finished?s(`Bot game: played to the end in {steps} moves.`,{steps:h.steps}):s(`Bot game: {rounds} rounds in {steps} moves, with nothing wrong.`,{rounds:K,steps:h.steps}),line:null}:{id:`soak`,ok:!1,text:s(`Bot game: {why}`,{why:h.failures[0]??``}),line:J(e,h.failures[0]??``)}:{id:`soak`,ok:!1,text:s(`Bot game: it didn't report back.`),line:null}),i()}var Y=h(),X=`https://`,ve=(0,D.lazy)(()=>c(()=>import(`./Editor-BATcjN88.js`).then(e=>({default:e.Editor})),__vite__mapDeps([3,4,5,6,2,1]),import.meta.url)),ye=[{id:`skirmish`,source:ie,name:()=>s(`Skirmish`),what:()=>s(`Model by model: move, then fight.`)},{id:`ranked`,source:ae,name:()=>s(`Ranked`),what:()=>s(`Regiment blocks that wheel and clash.`)},{id:`activations`,source:oe,name:()=>s(`Alternating activations`),what:()=>s(`Players take turns activating one unit each.`)},{id:`rift-lanterns`,source:x,name:()=>`Rift Lanterns`,what:()=>s(`A finished game of ours to take apart: four warbands, three missions.`)},{id:`brinewatch`,source:b,name:()=>`Brinewatch`,what:()=>s(`Our second, to take apart: action points, guards, hidden lurkers and a campaign.`)}];function be(){let[{drafts:e,current:n},r]=(0,D.useState)(se),i=e.find(e=>e.id===n)??null,a=y(e=>e.folded),o=y(e=>e.link),l=u(e=>e.session!==null),[d,f]=(0,D.useState)(`table`),[p,m]=(0,D.useState)(null),[h,g]=(0,D.useState)(null),[_,b]=(0,D.useState)(null),[x,S]=(0,D.useState)(null),C=async()=>{if(!i||x)return;b(null),S([]);let e=await _e(i.source,S);S(null),b(e),g(e.steps.find(e=>e.ok===!1)?.line??null)},w=(e,t)=>{ce(e,t),r({drafts:e,current:t})},T=t=>{let n=le(t);w([...e,n],n.id)},E=t=>{i&&(h!==null&&g(null),w(e.map(e=>e.id===i.id?{...e,source:t,updated:Date.now()}:e),i.id))},O=()=>{if(!i||!confirm(s(`Delete this draft? This can't be undone.`)))return;let t=e.filter(e=>e.id!==i.id);w(t,t.at(-1)?.id??null)};(0,D.useEffect)(()=>{o&&(y.setState({link:null}),Z(o).then(e=>{T(e),m({text:s(`Opened from {url}. Read it before you test it: saving runs its code in the sandbox.`,{url:o}),bad:!1})},e=>m({text:e.message,bad:!0})))},[o]);let k=(e,t=null)=>{m({text:e,bad:!0}),g(t)},A=async()=>{if(!i)return null;let n=i.source,r=B(n);if(r.length)return k(r[0]),null;let{syntaxError:a}=await c(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),o=a(n);if(o)return k(s(`Not saved: the code doesn't parse at line {line}, column {column}.`,o),o.line),null;let l;try{l=await G(n)}catch(e){return k(s(`Not saved: your rules didn't load: {why}`,{why:e instanceof Error?e.message:String(e)})),null}let d=l.errors[0]?.error;if(d)return k(s(`Not saved: your rules didn't load: {why}`,{why:d}),J(n,d)),null;g(null);let f=t.getState(),p=await f.add(new TextEncoder().encode(n),{own:!0});if(!p.ok)return k(p.error),null;f.trust(p.pkg.hash,!0),i.saved&&i.saved!==p.pkg.hash&&f.packages[i.saved]?.own&&we(i.saved),w(e.map(e=>e.id===i.id?{...e,saved:p.pkg.hash}:e),i.id);let h=Te(l);Ee(h);let _=p.pkg.manifest.systems[0],v=u.getState().game;if(u.getState().session&&v.packages?.system?.id===_){if(v.packages.packages.some(e=>e.hash===p.pkg.hash))return m({text:s(`Saved. Nothing changed for the test table.`),bad:!1}),p.pkg.hash;$(p.pkg.hash);let e=await Oe();e?k(s(`Saved, but your rules didn't load on the test table: {why}`,{why:e}),J(n,e)):m({text:Q.table!==null&&h!==Q.table?s(`Saved and reloaded. The sample armies, missions or table changed: restart the test table to play with them.`):s(`Saved and reloaded onto the test table.`),bad:!1})}else m({text:s(`Saved.`),bad:!1});return p.pkg.hash};if(a&&l)return(0,Y.jsx)(`button`,{className:`workshop-tab`,onClick:()=>y.setState({folded:!1}),children:s(`Workshop`)});let j=i?z(i.source):null;return(0,Y.jsxs)(`section`,{className:`workshop${l?` over-table`:``}`,role:l?`complementary`:`dialog`,"aria-label":s(`Module workshop`),children:[(0,Y.jsxs)(`header`,{className:`workshop-head`,children:[(0,Y.jsx)(`h2`,{children:s(`Module workshop`)}),e.length>0&&(0,Y.jsx)(`select`,{"aria-label":s(`Draft`),value:n??``,onChange:t=>w(e,t.target.value),children:e.map(e=>{let t=z(e.source);return(0,Y.jsx)(`option`,{value:e.id,children:typeof t==`string`?s(`Untitled draft`):`${t.name} ${t.version}`},e.id)})}),(0,Y.jsx)(`span`,{className:`spacer`}),l&&(0,Y.jsxs)(`button`,{onClick:()=>y.setState({folded:!0}),title:s(`Fold the workshop to the side`),children:[`⇥ `,s(`Table`)]}),(0,Y.jsx)(`button`,{onClick:v,"aria-label":s(`Close the workshop`),children:`✕`})]}),i?(0,Y.jsxs)(`div`,{className:`workshop-body`,children:[(0,Y.jsxs)(`div`,{className:`workshop-code`,children:[(0,Y.jsxs)(`div`,{className:`workshop-tools`,children:[(0,Y.jsx)(`button`,{className:`primary`,onClick:()=>void A(),title:s(`Save (Ctrl+S)`),children:s(`Save`)}),(0,Y.jsx)(ke,{save:A}),(0,Y.jsx)(`button`,{onClick:()=>void C(),disabled:!!x,title:s(`Check the types, load it, and let a bot play two rounds`),children:s(x?`Checking…`:`Check`)}),(0,Y.jsx)(`span`,{className:`spacer`}),(0,Y.jsx)(`button`,{onClick:()=>w(e,null),children:s(`New draft`)}),(0,Y.jsx)(`button`,{onClick:O,children:s(`Delete`)})]}),p&&(0,Y.jsx)(`p`,{className:`workshop-note${p.bad?` bad`:``}`,role:p.bad?`alert`:`status`,children:p.text}),(x||_)&&(0,Y.jsx)(Se,{steps:x??_.steps,verdict:x?null:_,stale:!!_&&_.source!==i.source,onClose:()=>b(null)}),(0,Y.jsx)(Ce,{draft:i}),(0,Y.jsx)(D.Suspense,{fallback:(0,Y.jsx)(`div`,{className:`workshop-editor`,children:s(`Loading the editor…`)}),children:(0,Y.jsx)(ve,{doc:i.source,onChange:E,onSave:()=>void A(),label:s(`The package's code`),mark:h})})]}),(0,Y.jsxs)(`aside`,{className:`workshop-side`,children:[(0,Y.jsx)(`div`,{className:`tabs`,role:`tablist`,children:[[`table`,s(`Test table`)],[`soak`,s(`Soak bot`)],[`export`,s(`Export`)],[`sdk`,s(`SDK`)]].map(([e,t])=>(0,Y.jsx)(`button`,{role:`tab`,"aria-selected":d===e,onClick:()=>f(e),children:t},e))}),d===`table`&&(0,Y.jsx)(Ae,{}),d===`soak`&&(0,Y.jsx)(je,{draft:i}),d===`export`&&typeof j!=`string`&&j&&(0,Y.jsx)(Me,{draft:i}),d===`export`&&typeof j==`string`&&(0,Y.jsx)(`p`,{children:j}),d===`sdk`&&(0,Y.jsx)(Ne,{})]})]}):(0,Y.jsx)(xe,{onPick:T})]})}function xe({onPick:e}){let[t,n]=(0,D.useState)(``),[r,i]=(0,D.useState)(null);return(0,Y.jsxs)(`div`,{className:`workshop-start`,children:[(0,Y.jsx)(`p`,{children:s(`Write a whole game as one JavaScript file: its rules as data, with code where data won't do. Start from a template; the test table plays it as you go.`)}),(0,Y.jsx)(`div`,{className:`workshop-templates`,children:ye.map(t=>(0,Y.jsxs)(`button`,{className:`workshop-template`,onClick:()=>e(t.source),children:[(0,Y.jsx)(`strong`,{children:t.name()}),(0,Y.jsx)(`span`,{children:t.what()})]},t.id))}),(0,Y.jsxs)(`form`,{className:`workshop-link`,onSubmit:n=>{n.preventDefault(),i(null),Z(t).then(e,e=>i(e.message))},children:[(0,Y.jsxs)(`label`,{children:[s(`Open from a link`),(0,Y.jsx)(`input`,{type:`url`,value:t,placeholder:X,onChange:e=>n(e.target.value),required:!0})]}),(0,Y.jsx)(`button`,{type:`submit`,children:s(`Open`)}),r&&(0,Y.jsx)(`p`,{className:`error`,children:r})]}),(0,Y.jsxs)(`p`,{children:[(0,Y.jsx)(`a`,{href:H,target:`_blank`,rel:`noreferrer`,children:s(`Community modules`)}),` · `,(0,Y.jsx)(`a`,{href:`${H.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:s(`How packages work`)})]})]})}async function Z(e){let t=e.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,`https://raw.githubusercontent.com/$1/`),n;try{n=await fetch(t)}catch{throw Error(s(`Couldn't fetch that link (it may not allow other sites to read it).`))}if(!n.ok)throw Error(s(`That link answered {status}.`,{status:n.status}));let r=await n.text();if(r.length>1048576)throw Error(s(`That's too big for a module.`));let i=z(r);if(typeof i==`string`)throw Error(s(`That isn't a rules package: {why}`,{why:i}));return r}function Se({steps:e,verdict:t,stale:n,onClose:r}){let i=t?t.ok?s(`Ready to share: nothing wrong found.`):s(`Not ready yet: {summary}`,{summary:t.summary}):s(`Checking: types, loading, then a short bot game…`);return(0,Y.jsxs)(`div`,{className:`workshop-check${t?t.ok?` ok`:` bad`:``}`,role:`status`,"aria-live":`polite`,children:[(0,Y.jsxs)(`div`,{className:`row spread`,children:[(0,Y.jsxs)(`strong`,{children:[t?t.ok?`✓ `:`✗ `:``,i]}),t&&(0,Y.jsx)(`button`,{className:`quiet`,onClick:r,title:s(`Hide`),children:`✕`})]}),n&&(0,Y.jsx)(`p`,{className:`muted small`,children:s(`The draft has changed since: check again.`)}),(0,Y.jsx)(`ul`,{children:e.map(e=>(0,Y.jsxs)(`li`,{className:e.ok===null?`skip`:e.ok?`ok`:`bad`,children:[e.ok===null?`–`:e.ok?`✓`:`✗`,` `,e.text]},e.id))})]})}function Ce({draft:e}){let t=(0,D.useMemo)(()=>B(e.source),[e.source]),n=T(e=>e.error),r=u(e=>e.session!==null),i=[...t,...r&&n?[n]:[]];return i.length?(0,Y.jsx)(`ul`,{className:`workshop-problems`,"aria-label":s(`Problems`),children:i.map(e=>(0,Y.jsxs)(`li`,{children:[`⚠ `,e]},e))}):null}function we(e){let n=()=>u.getState().game.packages?.packages.some(t=>t.hash===e)??!1;if(!n())return t.getState().remove(e);let r=u.subscribe(()=>{n()||(r(),t.getState().remove(e))})}function Te(e){let t=e.packages[0]?.provides?.app;return JSON.stringify(t?[t.samples,t.armies,t.missions,t.layout]:null)}var Q={table:null,last:null},Ee=e=>void(Q.last=e),De=()=>void(Q.table=Q.last);function Oe(){return new Promise(e=>{let t=T.getState().status===`starting`,n=t=>{r(),clearTimeout(i),e(t)},r=T.subscribe(e=>{e.status===`starting`?t=!0:t&&n(e.status===`on`?e.error:e.error??s(`the rules stopped`))}),i=setTimeout(()=>n(null),1e4)})}function $(e){let n=t.getState().packages[e];n&&u.getState().dispatch({type:`game/packages`,app:p,system:{id:n.manifest.systems[0],builtIn:!1},packages:[m(n)]})}function ke({save:e}){let n=u(e=>e.session!==null),[r,i]=(0,D.useState)(!1),a=async()=>{let n=await e();De();let r=n?t.getState().packages[n]:void 0;if(!r)return;i(!0);let a=u.getState();a.session&&(a.session.leave(),u.setState({session:null,role:null,scrub:null,selected:null,draft:null}));let s=r.manifest.systems[0];u.getState().start({role:`host`,mode:`hotseat`,name:localStorage.getItem(`open-battle:name`)??``,system:s}),$(r.hash);let c=0,d=()=>{let{game:e,dispatch:t}=u.getState(),n=T.getState();if(n.status===`stopped`)return i(!1);if(n.status!==`on`||!l(s)||e.system!==s||o(e).length<2){c++<200?setTimeout(d,50):i(!1);return}_.initial=u.getState().record.initial,g(()=>u.getState().game,t,crypto.randomUUID().slice(0,6)),u.getState().dispatch({type:`turn/next`}),i(!1)};d()};return(0,Y.jsx)(`button`,{onClick:()=>void a(),disabled:r,children:s(r?`Setting up…`:n?`Restart the test table`:`Test table`)})}function Ae(){let e=u(e=>e.session!==null),t=T(e=>e.status),n=T(e=>e.error),r=u(e=>e.record),i=S(),o=(0,D.useMemo)(()=>e?d(r).filter(e=>e.kind===`line`&&!e.undone).slice(-12).reverse():[],[e,r]);return e?(0,Y.jsxs)(`div`,{className:`workshop-table`,children:[(0,Y.jsxs)(`p`,{className:n&&t!==`starting`?`bad`:void 0,children:[s(t===`on`&&!n?`Your rules are running.`:t===`starting`?`Starting your rules…`:`Your rules aren't running.`),n&&t!==`starting`&&(0,Y.jsxs)(Y.Fragment,{children:[` `,n]})]}),(0,Y.jsx)(`p`,{children:(0,Y.jsx)(`button`,{onClick:w,children:a(i.length,`{n} table warning`,`{n} table warnings`,{n:i.length})})}),(0,Y.jsx)(`h3`,{children:s(`Dice and log`)}),(0,Y.jsx)(`ol`,{className:`workshop-log`,children:o.map(e=>(0,Y.jsx)(`li`,{children:e.kind===`line`?e.text:``},e.key))})]}):(0,Y.jsx)(`p`,{children:s(`Test table starts a game of your draft on this screen with each side's sample army. Every save reloads it there.`)})}function je({draft:e}){let[t,n]=(0,D.useState)([]),[r,i]=(0,D.useState)(!1),a=async()=>{i(!0),n([]),await U(e.source,[1,2,3],e=>n(t=>[...t,e])),i(!1)};return(0,Y.jsxs)(`div`,{className:`workshop-soak`,children:[(0,Y.jsx)(`p`,{children:s(`The soak bot plays whole games of your draft with random legal moves, over pretend peers, and checks every table stays the same and nothing throws.`)}),(0,Y.jsx)(`button`,{onClick:()=>void a(),disabled:r||B(e.source).length>0,children:s(r?`Playing…`:`Play 3 bot games`)}),(0,Y.jsx)(`ul`,{children:t.map(e=>(0,Y.jsx)(`li`,{className:e.ok?`ok`:`bad`,children:e.ok?e.finished?s(`Game {seed}: fine, played to the end in {steps} moves.`,{seed:e.seed,steps:e.steps}):s(`Game {seed}: fine for {steps} moves, stopped in round {round}.`,{seed:e.seed,steps:e.steps,round:e.round}):s(`Game {seed} went wrong: {why}`,{seed:e.seed,why:e.failures[0]??``})},e.seed))})]})}function Me({draft:e}){let[t,r]=(0,D.useState)(null),[i,a]=(0,D.useState)(``),[o,c]=(0,D.useState)(!1),l=z(e.source);return(0,D.useEffect)(()=>{let t=!0;return crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e.source)).then(e=>{t&&r(Array.from(new Uint8Array(e)).map(e=>e.toString(16).padStart(2,`0`)).join(``))}),()=>{t=!1}},[e.source]),typeof l==`string`?(0,Y.jsx)(`p`,{children:l}):(0,Y.jsxs)(`div`,{className:`workshop-export`,children:[(0,Y.jsxs)(`p`,{children:[s(`{name} {version}`,{name:l.name,version:l.version}),t&&(0,Y.jsxs)(Y.Fragment,{children:[` · `,(0,Y.jsx)(`code`,{title:t,children:n(t)})]})]}),(0,Y.jsx)(`button`,{className:`primary`,onClick:()=>{f(new Blob([e.source],{type:`text/javascript`}),ue(l))},children:s(`Download the package`)}),(0,Y.jsx)(`p`,{className:`hint`,children:s(`Players load the file in Rules packages; peers check they have the same bytes by this fingerprint.`)}),(0,Y.jsx)(`h3`,{children:s(`Share it in the gallery`)}),(0,Y.jsx)(`p`,{className:`hint`,children:s(`To host it: make a gist at gist.github.com, paste the file in, save, and copy its Raw link. A file in a GitHub repository works too (its Raw button).`)}),(0,Y.jsxs)(`label`,{children:[s(`Where the file is hosted (a raw link)`),(0,Y.jsx)(`input`,{type:`url`,value:i,placeholder:X,onChange:e=>a(e.target.value)})]}),(0,Y.jsx)(`button`,{disabled:!t,onClick:()=>void navigator.clipboard.writeText(fe(l,t,i)).then(()=>{c(!0),setTimeout(()=>c(!1),2e3)}),children:s(o?`Copied`:`Copy the pull request text`)}),` `,(0,Y.jsx)(`a`,{href:de,target:`_blank`,rel:`noreferrer`,children:s(`Edit the gallery on GitHub`)})]})}function Ne(){let e=(e,t)=>(0,Y.jsxs)(Y.Fragment,{children:[(0,Y.jsx)(`h3`,{children:e}),(0,Y.jsx)(`dl`,{className:`workshop-ref`,children:t.map(e=>(0,Y.jsxs)(`div`,{children:[(0,Y.jsx)(`dt`,{children:(0,Y.jsxs)(`code`,{children:[e.label,e.detail&&e.detail!==`snippet`?` ${e.detail}`:``]})}),(0,Y.jsx)(`dd`,{children:typeof e.info==`string`?e.info:``})]},e.label))})]});return(0,Y.jsxs)(`div`,{className:`workshop-sdk`,children:[(0,Y.jsx)(`p`,{children:s(`Everything a package can use. In the editor, type ctx. or view. for suggestions.`)}),e(s(`Commands a rule yields (ctx.)`),A),e(s(`The game as it stands (view.)`),j),e(s(`Keys and snippets`),M),(0,Y.jsx)(`p`,{children:(0,Y.jsx)(`a`,{href:`${H.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:s(`How packages work`)})}),(0,Y.jsxs)(`details`,{children:[(0,Y.jsx)(`summary`,{children:s(`The full types`)}),(0,Y.jsx)(`pre`,{children:re})]})]})}export{be as Workshop,ee as n,L as t};