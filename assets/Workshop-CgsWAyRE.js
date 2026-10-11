const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./syntax-CEL_Wvla.js","./dist-YYVtoirG.js","./dist-lgRNSFRF.js","./Editor-BtW3o-WO.js","./rolldown-runtime-hePW80VL.js","./react-Cvdyeg_0.js","./jsx-runtime-NZYk81nU.js"])))=>i.map(i=>d[i]);
import{r as e}from"./rolldown-runtime-hePW80VL.js";import{t}from"./react-Cvdyeg_0.js";import{$ as n,Dr as r,In as i,Ln as a,Mt as o,Q as s,Rt as c,Tr as l,X as u}from"./core-D-UGyuWg.js";import{t as d}from"./preload-helper-BaNbYf_w.js";import{_ as f,f as p,it as m,y as h}from"./store-BylyVIVL.js";import{a as g,i as _,r as v,t as y}from"./manifest-BRIPGYy3.js";import{d as b,u as x}from"./systemLabels-CsFOSdzS.js";import{t as S,v as C}from"./gameLog-D9gS2Igy.js";import"./roster-CVZButfQ.js";import{n as w}from"./files-CdfAAl3C.js";import{t as ee}from"./jsx-runtime-NZYk81nU.js";import{h as T,n as E}from"./shelfActions-DkY_8Nd1.js";import{r as D}from"./help-Df6mWeAo.js";import{n as O}from"./showcase-Dcyx4k9V.js";import{C as te,F as ne,S as re,b as k,g as ie,w as A,x as ae,y as j}from"./index-Q-JN-xH1.js";import oe from"./brinewatch-DN2-OwGh.js";import se from"./rift-lanterns-DLDKmR7R.js";import{S as ce,b as M,o as le,s as ue,t as de}from"./TeachRule-DAshAEZv.js";import{s as N}from"./dist-lgRNSFRF.js";var P=e(t(),1),F=(e,t,n)=>({label:e,detail:t,info:n,type:`function`}),I=(e,t,n)=>({label:e,detail:t,info:n,type:`property`}),fe=[I(`view`,`: GameView`,`The game as it stands: units, distances, line of sight.`),F(`roll`,`(dice, label?, unitId?, need?)`,'Roll dice with the host\'s dice, e.g. ctx.roll("3d6", "hits", unitId, 4). With `need`, each die of that score or more is a success.'),F(`note`,`(text)`,`A line in the game log.`),F(`ask`,`(player, question, options)`,`Ask a player to choose; the result is the option id.`),F(`run`,`(procedure, roles)`,`Run one of the system's data procedures to the end; the result says what each step rolled.`),F(`emit`,`(event)`,`Change the table with an event, e.g. { type: "model/wounds", id, woundsLost, destroyed }.`),F(`set`,`(key, value)`,`Remember a value for this player's package (read back from view.own[key]).`),F(`secret`,`(player, key, question, options)`,`A choice kept on the player's device; only a commitment goes on the table.`),F(`reveal`,`(player, key)`,`Have a player reveal a secret they committed.`)],pe=[I(`round`,`: number`,`The battle round (0 while setting up).`),I(`phase`,`: string | null`,`The current phase's id.`),I(`activePlayer`,`: string | null`,`Whose turn it is.`),F(`unit`,`(id)`,`A unit by id.`),F(`units`,`(player?)`,`Every unit, or one player's.`),F(`distance`,`(a, b)`,`Closest distance between two units' bases, in the system's units.`),F(`visible`,`(from, to)`,`Whether a unit can see another.`),F(`inCover`,`(from, to)`,`Whether the target is in cover from the shooter.`),F(`arc`,`(of, other)`,`Which arc of a unit another is in (front, flank, rear), for ranked games.`),F(`engaged`,`(unitId)`,`Enemy units this one is engaged with.`),I(`own`,`: Record<string, unknown>`,`This player's package values (ctx.set).`),I(`state`,`: GameState`,`The whole game state, read-only.`)],me=[I(`id`,`manifest / module / action`,`A stable id: a package's must stay the same across versions.`),I(`name`,`manifest / action`,`What players see.`),I(`version`,`manifest / module`,`Semantic version, e.g. 0.1.0.`),I(`author`,`manifest`,`Who wrote it.`),I(`api`,`manifest / module`,`The SDK version: 1.`),I(`kind`,`manifest`,`"system" for a whole game, "extension" for additions to one.`),I(`systems`,`manifest`,`The system ids it brings or changes.`),I(`requires`,`manifest`,`Other packages it needs.`),I(`adds`,`manifest`,`One line on what it adds, shown before a player trusts it.`),I(`system`,`module`,`The rules as data: characteristics, dice, the turn (src/core/content/schema.ts).`),I(`app`,`module`,`The app glue: sample armies, the table layout, rank rules, a side panel.`),I(`actions`,`module`,`Code actions: buttons on a unit card or for a player.`),I(`procedures`,`module`,`Named generator procedures, run by data or by ctx.run.`),I(`hooks`,`module`,`Turn hooks: phaseStart, phaseEnd, roundStart, activationEnd.`),I(`functions`,`module`,`Pure functions data rules can call.`),I(`checks`,`module`,`(view) => warnings for the table warnings panel.`),I(`by`,`action`,`"unit" or "player".`),I(`phases`,`action`,`Phase ids it's offered in (an alternate's id for activations).`),F(`available`,`(view, actor)`,`true, or why not.`),F(`targets`,`(view, actor)`,`The targets to pick from: { unitId, label }.`),F(`run`,`function* (ctx, args)`,`What it does: yield ctx commands.`),F(`sample`,`(seat)`,`The test table's army for a seat.`),F(`layout`,`(table)`,`Terrain, objectives and deployment zones.`),F(`sidePanel`,`(view)`,`A panel of lines and buttons, or null.`),I(`armies`,`app`,`Every sample army players pick from, one per faction.`),I(`missions`,`app`,`Missions picked at setup: zones, objectives and scoring.`),I(`templateCategory`,`app`,`What each terrain template counts as, e.g. { Woods: "cover" }.`),I(`phaseStart`,`hooks`,`{ [phaseId]: function* (ctx) }`),I(`phaseEnd`,`hooks`,`{ [phaseId]: function* (ctx) }`),F(`roundStart`,`function* (ctx)`,`At the start of each round.`),F(`activationEnd`,`function* (ctx)`,`When a unit's activation ends.`),N(`{
  id: "\${id}",
  name: "\${Name}",
  by: "unit",
  phases: ["\${phase}"],
  available: (view, actor) => true,
  targets: (view, actor) => [],
  run: function* (ctx, args) {
    yield ctx.note("\${Name}");
  },
}`,{label:`action`,detail:`snippet`,info:`A code action on a unit card.`,type:`keyword`}),N('function* ${name}(ctx, args) {\n  const roll = yield ctx.roll("${2d6}", "${label}");\n  ${}\n}',{label:`procedure`,detail:`snippet`,info:`A generator procedure: yield commands, read their results.`,type:`keyword`}),N('{ kind: "phase", id: "${id}", name: "${Name}" }',{label:`phase`,detail:`snippet`,info:`A phase in the turn.`,type:`keyword`}),N('{ id: "${id}", name: "${Name}", of: "model", type: "number" }',{label:`characteristic`,detail:`snippet`,info:`A stat on each model's profile.`,type:`keyword`}),N(`{
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
}`,{label:`mission`,detail:`snippet`,info:`A mission: setup and scoring.`,type:`keyword`}),N('{ template: "${Ruin}", id: "${id}", position: { x: ${0}, y: ${0} }, facing: 0 }',{label:`terrain`,detail:`snippet`,info:`A terrain piece from a template (Ruin, Small ruin, Tall ruin, Container, Woods, Barricade, Crater, Hill).`,type:`keyword`}),N('look: { shape: "${trooper}", color: "${#8a6bb8}" }',{label:`look`,detail:`snippet`,info:`A model's stand-in figure: trooper, brute, robed, beast, walker, drone or vehicle.`,type:`keyword`}),N('(view) => [{ unitId: ${id}, message: "${what is wrong}", severity: "warning" }]',{label:`check`,detail:`snippet`,info:`A table warning.`,type:`keyword`})];function he(e){let t=e.matchBefore(/\b(ctx|view)\.\w*$/);if(t){let e=t.text.indexOf(`.`);return{from:t.from+e+1,options:t.text.startsWith(`ctx`)?fe:pe,validFor:/^\w*$/}}let n=e.matchBefore(/\w+$/);return!n&&!e.explicit||n&&e.state.sliceDoc(n.from-1,n.from)===`.`?null:{from:n?.from??e.pos,options:me,validFor:/^\w*$/}}var L=null,R=!1,ge=1,z=new Map;function _e(){if(L||R)return L;try{L=new Worker(new URL(new URL(`typesWorker-tq9z9DOy.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`workshop-types`})}catch{return R=!0,null}return L.onmessage=e=>{z.get(e.data.id)?.(e.data.result),z.delete(e.data.id)},L.onerror=()=>{R=!0,L?.terminate(),L=null;for(let e of z.values())e(null);z.clear()},L}function B(e){let t=_e();if(!t)return Promise.resolve(null);let n=ge++;return new Promise(r=>{z.set(n,e=>r(e)),t.postMessage({...e,id:n})})}var V={problems:async e=>await B({t:`problems`,source:e})??[],hover:(e,t)=>B({t:`hover`,source:e,pos:t}),complete:async(e,t)=>await B({t:`complete`,source:e,pos:t})??[],detail:(e,t,n)=>B({t:`detail`,source:e,pos:t,name:n}),available:()=>!R},ve=`import type { GameSystem, Id } from "../core/content/schema";
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

/** A faction pack's data (#76, docs/faction-packs.md): \`export const faction: FactionPack = { ... }\`. */
export type { FactionPack, PackDetachment, PackRule, PackStratagem } from "../packages/factionFormat";
`,ye=`// A starter game for the module workshop: a skirmish game, model by model.
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
`,be=`// A starter game for the module workshop: rank-and-flank regiments that move
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
`,xe=`// A starter game for the module workshop: alternating activations. Players
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
`,Se=`// A faction pack to start from (#79). Everything in it is invented: the
// Vanguard Legion is one of the app's own sample armies, and the rules below
// were made up for this file. A pack teaches the app what rules do BY NAME:
// unit abilities, army and detachment rules, enhancements and stratagems.
// Never put a publisher's rules text in a pack: names, and your own words.
//
// In the workshop, pick an army (Army tab): it lists the names in that army,
// and "Build" writes a rule for a name into \`faction\` below, as data. Test
// table plays your army with the pack on it; Export downloads the file to
// host anywhere. See docs/faction-packs.md for the format.

/** Read as data before anything runs: a plain literal, no variables or calls. */
export const manifest = {
  id: "me.my-faction-pack",
  name: "My faction pack",
  version: "0.1.0",
  author: "Me",
  api: 1,
  kind: "faction",
  systems: ["forty-k"],
  requires: [],
  adds: "Rules for the invented Vanguard Legion: three unit abilities, a faction rule, and the Spearhead Muster detachment's rule and two stratagems.",
};

// The rules, keyed by name. Each says what it does in one of four ways:
// - teach: what "Teach it this rule" builds (when, who, what), the easiest;
// - auto: the automated-ability parts the app's ability reader writes;
// - effects: rules-schema effects, as a package's data rules write them;
// - code: the pack's own code plays it (give the file a default export with
//   hooks, as docs/packages.md shows).
// A rule with only a summary is played by hand, with your words as its reminder.
// The workshop writes this literal back when you build a rule, so keep notes
// up here rather than inside it.
export const faction = {
  faction: "Vanguard Legion",
  rules: [
    {
      name: "Shoulder to Shoulder",
      summary: "Each model in this army ignores a lost wound on a 6.",
      teach: { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "fnp", x: 6 }] },
    },
  ],
  abilities: [
    {
      name: "Hold the Line",
      summary: "While this unit is within range of an objective, add 1 to its saving throws.",
      teach: {
        when: { kind: "attacks" },
        who: { kind: "self" },
        what: [{ kind: "save", by: 1 }],
        onObjective: "within",
      },
    },
    {
      name: "Rally Call",
      summary: "Once per battle, for one phase: re-roll failed Hit rolls for this unit's attacks.",
      teach: {
        when: { kind: "attacks" },
        who: { kind: "self" },
        what: [{ kind: "reroll", roll: "hit", which: "failed" }],
        oncePerBattle: true,
      },
    },
    {
      name: "Steady Gait",
      summary: "This model can shoot after it Falls Back.",
    },
  ],
  detachments: [
    {
      name: "Spearhead Muster",
      rules: [
        {
          name: "Drilled Volleys",
          summary: "Ranged attacks of a unit that stayed still re-roll Hit rolls of 1.",
          teach: {
            when: { kind: "attacks", weapon: "ranged", when: "stationary" },
            who: { kind: "self" },
            what: [{ kind: "reroll", roll: "hit", which: "ones" }],
          },
        },
      ],
      enhancements: [],
      stratagems: [
        {
          name: "Focused Fire",
          cp: 1,
          side: "active",
          phases: ["shooting"],
          target: { notYet: "shot" },
          summary: "Your unit's ranged attacks add 1 to the Wound roll this phase.",
          teach: {
            when: { kind: "attacks", weapon: "ranged" },
            who: { kind: "self" },
            what: [{ kind: "modify", roll: "wound", by: 1 }],
          },
        },
        {
          name: "Smoke Drill",
          cp: 1,
          side: "inactive",
          phases: ["shooting"],
          once: "turn",
          summary: "Ranged attacks against your unit subtract 1 from the Hit roll this phase.",
          teach: {
            when: { kind: "attacks", weapon: "ranged" },
            who: { kind: "self" },
            what: [{ kind: "against", roll: "hit", by: -1 }],
          },
        },
      ],
    },
  ],
};
`,Ce=`open-battle:workshop`;function we(){try{let e=JSON.parse(localStorage.getItem(Ce)??`null`);if(e&&Array.isArray(e.drafts))return e}catch{}return{drafts:[],current:null}}function Te(e,t){try{localStorage.setItem(Ce,JSON.stringify({drafts:e,current:t}))}catch{}}function Ee(e){return{id:crypto.randomUUID().slice(0,8),source:e,updated:Date.now()}}function H(e){let t=_(e);return`error`in t?t.error:t.manifest}function U(e){let t=H(e);if(typeof t==`string`)return[t];if(t.kind===`faction`){let t=k(e);return`error`in t?[t.error]:[]}let n=[];return t.kind!==`system`&&n.push(`The workshop tests whole games: set manifest.kind to "system".`),t.systems[0]||n.push(`Name the game's system id in manifest.systems.`),/export\s+default\b/.test(e)||n.push(`Export the game: export default { module }.`),n}function De(e){return`${e.id.replace(/[^\w.-]+/g,`-`)}-${e.version}.js`}var Oe=`https://github.com/pwestling/Web40k`,W=`${Oe}/blob/main/docs/community-modules.md`,ke=`${Oe}/edit/main/docs/community-modules.md`;function Ae(e,t,n){let r=n||`<the module's raw URL>`;return[`## Add ${e.name} ${e.version} to the community modules`,``,e.adds??``,``,`Row for docs/community-modules.md:`,``,"```",`| [${e.name}](${r}) | ${e.version} | ${e.author??``} | ${e.systems.join(`, `)} | ${e.adds??``} | \`${t.slice(0,16)}\` |`,"```",``,`- Package id: \`${e.id}\` (kind: ${e.kind})`,`- SHA-256: \`${t}\``,`- Tested in the module workshop: the test table and the soak bot.`,`- No Games Workshop text, names or stats in the file.`].join(`
`)}var je=12e4;async function Me(e,t,n,r){let i=null,a;try{let e=(await d(async()=>{let{default:e}=await import(`./_virtual_soak-worker-BvAey2xi.js`);return{default:e}},[],import.meta.url)).default;a=await ce.start(e,e=>i=e)}catch(e){let r=e instanceof Error?e.message:String(e);for(let e of t)n({seed:e,ok:!1,failures:[r],steps:0,round:0,finished:!1});return}try{for(let o of t)try{n(await a.call({t:`soak`,source:e,seed:o,...r===void 0?{}:{untilRound:r}},je))}catch(e){if(n({seed:o,ok:!1,failures:[i??(e instanceof Error?e.message:String(e))],steps:0,round:0,finished:!1}),i)return}}finally{a.stop()}}var G=null;async function Ne(e){G??=(async()=>{let e=(await d(async()=>{let{default:e}=await import(`./_virtual_soak-worker-BvAey2xi.js`);return{default:e}},[],import.meta.url)).default;return ce.start(e,()=>G=null)})();try{return await(await G).call({t:`check`,source:e},Pe)}catch(e){throw G=null,e}}var Pe=5e3;function Fe(e,t){let n=(/^system\.([\w.[\]]+)/.exec(t)?.[1])?.replace(/\[\d+\]/g,``).split(`.`).at(-1);if(!n)return null;let r=e.search(/\bconst\s+system\b|\bsystem\s*[:=]\s*{/),i=e.slice(Math.max(0,r)).search(RegExp(`\\b${n}\\s*:`));return i<0?null:e.slice(0,Math.max(0,r)+i).split(`
`).length}function Ie(e){let t=[];for(let n of e)n.ok===!1&&(n.id===`code`?t.push(n.text):n.id===`types`?t.push(r(n.count??1,`{n} type problem`,`{n} type problems`)):n.id===`load`?t.push(l(`it doesn't load`)):t.push(l(`the bot game went wrong`)));return t.join(`, `)}var Le=2,Re=(e,t)=>e.slice(0,t).split(`
`).length;function K(e,t){let n=/line (\d+)/.exec(t);return n?Number(n[1]):Fe(e,t)}async function ze(e,t){let n=[],i=()=>t([...n]),a=()=>({ok:n.every(e=>e.ok!==!1),source:e,steps:n,summary:Ie(n)}),o=U(e),{syntaxError:s}=await d(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),c=s(e);if(o.length||c)return n.push({id:`code`,ok:!1,text:o[0]??l(`The code doesn't parse at line {line}, column {column}.`,c),line:c?.line??null}),a();let[u,f]=await Promise.all([V.available()?V.problems(e):Promise.resolve(null),Ne(e).then(e=>e.errors[0]?.error??null,e=>e instanceof Error?e.message:String(e))]),p=u?.filter(e=>e.severity===`error`)??[];if(n.push(u===null?{id:`types`,ok:null,text:l(`Types: the type checker isn't available here.`),line:null}:p.length?{id:`types`,ok:!1,text:r(p.length,`Types: {n} problem. Line {line}: {message}`,`Types: {n} problems. The first, line {line}: {message}`,{line:Re(e,p[0].from),message:p[0].message}),line:Re(e,p[0].from),count:p.length}:{id:`types`,ok:!0,text:l(`Types: everything matches the SDK.`),line:null}),n.push(f?{id:`load`,ok:!1,text:l(`Loading: {why}`,{why:f}),line:K(e,f)}:{id:`load`,ok:!0,text:l(`Loading: it loads, and its system has the right shape.`),line:null}),i(),f)return n.push({id:`soak`,ok:null,text:l(`Bot game: not played, since it doesn't load.`),line:null}),a();let m=null;await Me(e,[1],e=>m=e,Le);let h=m;return n.push(h?h.ok?{id:`soak`,ok:!0,text:h.finished?l(`Bot game: played to the end in {steps} moves.`,{steps:h.steps}):l(`Bot game: {rounds} rounds in {steps} moves, with nothing wrong.`,{rounds:Le,steps:h.steps}),line:null}:{id:`soak`,ok:!1,text:l(`Bot game: {why}`,{why:h.failures[0]??``}),line:K(e,h.failures[0]??``)}:{id:`soak`,ok:!1,text:l(`Bot game: it didn't report back.`),line:null}),a()}var Be=(e,t)=>t.auto?.pack?`pack`:t.auto?.taught?`taught`:s(e,t)?`automated`:`manual`;function q(e,t,r=[]){let i=[],a=new Map,o=e=>{let t=`${e.kind===`stratagem`?`s`:`r`}/${j(e.name)}`,n=a.get(t);if(n){for(let t of e.units)n.units.includes(t)||n.units.push(t);return}a.set(t,e),i.push(e)},s=e.army;for(let e of s?.rules??[]){if(n(t,e))continue;let r=e.group===`Army rule`||!s?.detachment?`army`:`detachment`;o({name:e.name,kind:r,text:e.text,status:Be(t,e),...J(e),units:[]})}for(let n of e.units){let e={sheet:n.sheet};for(let i of n.sheet.abilities)r.includes(i.group??``)||i.group!==`Enhancements`&&u(t,e,i)||s?.rules.some(e=>j(e.name)===j(i.name))||o({name:i.name,kind:i.group===`Enhancements`?`enhancement`:`ability`,text:i.text,status:Be(t,i),...J(i),units:[n.name]})}for(let e of s?.stratagems??[])o({name:e.name,kind:`stratagem`,text:e.text,status:e.auto?.pack||e.pack?`pack`:e.auto?.taught?`taught`:e.auto?`automated`:`manual`,...J(e),stratagem:e,units:[]});return i}var J=e=>e.auto?{auto:e.auto}:{};function Y(e,t,n,r){let i={name:e,...r?.trim()?{summary:r.trim()}:{}};if(!t)return i;let a=re(t),o=e=>{if(!e)return null;let{effects:t,taught:n,pack:r,...i}=e;return i};return JSON.stringify(o(ae(a,n)))===JSON.stringify(o(t))?{...i,teach:a}:{...i,auto:o(t)}}function Ve(e,t,n,r){let{name:i,...a}=Y(e.name,t,n,r),o=e.targetsUnit!==!1||!!t;return{name:e.name,cp:e.cp,side:e.side,...e.phases?.length?{phases:e.phases}:{},...e.once&&e.once!==`phase`?{once:e.once}:{},...o?e.targetKeywords||e.notYet?{target:{...e.targetKeywords?{keywords:e.targetKeywords}:{},...e.notYet?{notYet:e.notYet}:{}}}:{}:{target:!1},...a}}function He(e,t){return e===`ability`?{list:`abilities`}:e===`army`?{list:`rules`}:t?{detachment:t,list:e===`enhancement`?`enhancements`:e===`stratagem`?`stratagems`:`rules`}:{list:e===`enhancement`?`abilities`:e===`stratagem`?`stratagems`:`rules`}}function Ue(e,t,n,r){let i=JSON.parse(JSON.stringify(e)),a=j(n.name),o=t===`stratagem`?[...(i.detachments??[]).map(e=>e.stratagems),i.stratagems]:[i.abilities,i.rules,...(i.detachments??[]).flatMap(e=>[e.rules,e.enhancements])];for(let e of o){let t=e?.findIndex(e=>j(e.name)===a)??-1;if(t<0)continue;let r=e[t];return e[t]={...n,...!n.summary&&r.summary?{summary:r.summary}:{}},i}let s=He(t,r);if(`detachment`in s){i.detachments??=[];let e=i.detachments.find(e=>j(e.name)===j(s.detachment));e||i.detachments.push(e={name:s.detachment}),(e[s.list]??=[]).push(n)}else(i[s.list]??=[]).push(n);return i}function We(e,t){return q(e,t).filter(e=>e.status===`taught`&&e.auto).map(e=>({kind:e.kind,entry:e.kind===`stratagem`&&e.stratagem?Ve({...e.stratagem,targetsUnit:!0},e.auto,t):Y(e.name,e.auto,t)}))}function Ge(e,t,n){let r=We(t,n);return{pack:r.reduce((e,{kind:n,entry:r})=>Ue(e,n,r,t.army?.detachment),e),count:r.length}}var Ke=/^[A-Za-z_$][\w$]*$/,qe=100;function Je(e,t=``){if(typeof e!=`object`||!e)return JSON.stringify(e??null);let n=t+`  `,r=Array.isArray(e),i=r?e.map(e=>Je(e,n)):Object.entries(e).filter(([,e])=>e!==void 0).map(([e,t])=>`${Ke.test(e)?e:JSON.stringify(e)}: ${Je(t,n)}`),[a,o]=r?[`[`,`]`]:[`{`,`}`];if(!i.length)return`${a}${o}`;let s=r?`[${i.join(`, `)}]`:`{ ${i.join(`, `)} }`;return!s.includes(`
`)&&t.length+s.length<=qe?s:`${a}\n${i.map(e=>`${n}${e},`).join(`
`)}\n${t}${o}`}function Ye(e,t){let n=Je(t),r=v(e,`faction`);if(r&&`start`in r)return e.slice(0,r.start)+n+e.slice(r.end);let i=`\nexport const faction = ${n};\n`,a=v(e,`manifest`);if(a&&`end`in a){let t=e.indexOf(`;`,a.end)===a.end?a.end+1:a.end;return e.slice(0,t)+`
`+i+e.slice(t)}return e+i}function Xe(e){let t=k(e);return`error`in t?t.error:t.pack}var Ze=`\0draft`;function Qe(e,t,n,r=[]){return q(ie(e,t,{id:`draft`,name:Ze,version:`0`,hash:`draft`,bytes:0},n).roster,n,r)}var $e=e=>e.auto?.pack===Ze?e.auto:null,et=e=>e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);function tt(e,t,n=0){let r=Math.max(0,e.search(/export\s+const\s+faction\b/)),i=RegExp(`\\bname\\s*:\\s*(["'\`])${et(t)}\\1`,`g`);i.lastIndex=r;let a=null;for(let t=0;t<=n;t++)if(a=i.exec(e),!a)return null;return e.slice(0,a.index).split(`
`).length}function nt(e,t,n,r,i=[]){let a=q(n,r,i),o=(e,t)=>a.some(n=>t.includes(n.kind)&&j(n.name)===e),s=[],c=[],l=new Map,u=new Set,d=n.army,f=!t.faction||!d?.faction||j(t.faction)===j(d.faction),p=(t,n,r)=>{let i=l.get(t)??0;s.push({name:t,where:n,line:tt(e,t,Math.max(0,i-1)),why:r})},m=(e,t,n,r,i)=>{for(let a of e??[]){let e=j(a.name);l.set(a.name,(l.get(a.name)??0)+1);let s=`${i}/${e}`;if(u.has(s)){p(a.name,t,`twice`);continue}u.add(s),!o(e,n)&&(r?c.push(a.name):p(a.name,t,n.includes(`army`)&&!f?`faction`:n.includes(`army`)?`not-army-rule`:`no-unit`))}};m(t.rules,`rules`,[`army`,`detachment`,`ability`],f,`rule`),m(t.abilities,`abilities`,[`ability`,`enhancement`],!1,`rule`),m(t.stratagems,`stratagems`,[`stratagem`],!0,`strat`),(t.detachments??[]).forEach((e,t)=>{if(!(d?.detachment&&j(e.name)===j(d.detachment))){l.set(e.name,(l.get(e.name)??0)+1),p(e.name,`detachments[${t}]`,`detachment`);return}m(e.rules,`detachments[${t}].rules`,[`detachment`,`army`,`ability`],!0,`rule`),m(e.enhancements,`detachments[${t}].enhancements`,[`enhancement`,`ability`],!1,`rule`),m(e.stratagems,`detachments[${t}].stratagems`,[`stratagem`],!0,`strat`)});let h=Qe(n,t,r,i),g=new Set(a.map(e=>`${e.kind===`stratagem`}/${j(e.name)}`)),_=h.filter(e=>g.has(`${e.kind===`stratagem`}/${j(e.name)}`));return{problems:s,added:c,matched:_.filter(e=>$e(e)).length,uncovered:_.filter(e=>e.status===`manual`)}}function rt(e,t){let n=e=>t.some(t=>x(t,e)),r=Object.values(e).filter(e=>n(e.system)&&e.roster.units.length).sort((e,t)=>t.savedAt-e.savedAt).map(e=>({key:e.id,name:e.name,system:e.system,roster:e.roster,shelf:e}));if(!n(`forty-k-11`))return r;let i=[0,1].map(e=>{let t=h(o).sample(e);return{key:`sample:${e}`,name:t.name,system:o,roster:t}});return[...r,...i]}function it(e,t){return{id:e.manifest.id,name:e.manifest.name,version:e.manifest.version,hash:e.hash,bytes:e.bytes,...t?{code:!0}:{}}}var X=null,at=(e,t,n,r)=>ie(e.roster,n.pack,it(t,n.code),c({system:r})).roster;function ot(e,t){let{game:n,dispatch:r}=p.getState(),i=n.packages?.packages??[],a=[...i.filter(t=>t.id!==e.manifest.id),...t?[ne(e)]:[]];JSON.stringify(a)!==JSON.stringify(i)&&r({type:`game/packages`,app:m,system:{id:n.system??`forty-k-11`,builtIn:!0},packages:a,...n.turn.round>0?{agreed:Object.values(n.players).filter(e=>e.seat!==void 0).map(e=>e.id)}:{}})}function st(e,t,n){let r=p.getState();r.session&&(r.session.leave(),p.setState({session:null,role:null,scrub:null,selected:null,draft:null}));let o=e.system;return p.getState().start({role:`host`,mode:`hotseat`,name:localStorage.getItem(`open-battle:name`)??``,system:o}),new Promise(r=>{let s=0,c=()=>{let{game:l,dispatch:u}=p.getState();if((l.system??`forty-k-11`)!==o||a(l).length<2){s++<200?setTimeout(c,50):r(!1);return}O.initial=p.getState().record.initial;let d=crypto.randomUUID().slice(0,6),f=h(o).sample(e.key===`sample:1`?0:1);D(()=>p.getState().game,u,d,[at(e,t,n,o),f]);let m=i(p.getState().game,0)[0].id;X={owner:m,prefix:`${m}-${d}`,army:e,system:o},e.shelf&&E(e.shelf,m,X.prefix),ot(t,n.code),p.getState().dispatch({type:`turn/next`}),r(!0)};c()})}function ct(e,t){let{game:n,dispatch:r,session:i}=p.getState();if(!X||!i||(n.system??`forty-k-11`)!==X.system)return!1;let{owner:a,prefix:o,army:s,system:c}=X,l=at(s,e,t,c);return l.units.forEach((e,t)=>{let i=n.units[`${o}-${t}`];if(i?.sheet)for(let t of e.sheet.abilities){let e=i.sheet.abilities.find(e=>e.name===t.name);e&&JSON.stringify(e.auto??null)!==JSON.stringify(t.auto??null)&&r({type:`unit/automate`,id:i.id,ability:t.name,auto:t.auto??null},a)}}),l.army&&r({type:`player/army`,army:l.army},a),ot(e,t.code),!0}var Z=ee();function Q(e){let t=T(e=>e.armies);(0,P.useEffect)(()=>void T.getState().load(),[]);let n=H(e.source),r=typeof n==`string`?``:n.systems.join(` `),i=(0,P.useMemo)(()=>rt(t,r.split(` `).filter(Boolean)),[t,r]),a=i.find(t=>t.key===e.army)??i[0]??null,o=(0,P.useMemo)(()=>Xe(e.source),[e.source]),s=a?c({system:a.system}):null,l=a?h(a.system).profileGroups??[]:[];return{armies:i,army:a,system:s,pack:o,check:(0,P.useMemo)(()=>a&&s&&typeof o!=`string`?nt(e.source,o,a.roster,s,l):null,[a,s,o,e.source]),profiles:l}}function lt(e,t){switch(e.why){case`no-unit`:return l(`{name}: no unit in {army} has it.`,{name:e.name,army:t});case`not-army-rule`:return l(`{name}: {army} has no rule by that name.`,{name:e.name,army:t});case`faction`:return l(`{name}: a rule for another faction than {army}'s.`,{name:e.name,army:t});case`detachment`:return l(`Detachment {name}: {army} isn't in it, so nothing in it applies.`,{name:e.name,army:t});case`twice`:return l(`{name} is in the pack twice: keep one.`,{name:e.name})}}function ut({draft:e,onLine:t}){let{army:n,check:r}=Q(e);return!n||!r?.problems.length?null:(0,Z.jsx)(`ul`,{className:`workshop-problems pack-problems`,"aria-label":l(`Names that don't match`),children:r.problems.map((e,r)=>(0,Z.jsxs)(`li`,{children:[`⚠ `,lt(e,n.name),` `,e.line!==null&&(0,Z.jsx)(`button`,{className:`quiet small`,onClick:()=>t(e.line),children:l(`line {line}`,{line:e.line})})]},`${e.where}/${e.name}/${r}`))})}var dt={ability:()=>l(`Unit abilities`),enhancement:()=>l(`Enhancements`),army:()=>l(`Army rules`),detachment:()=>l(`Detachment rules`),stratagem:()=>l(`Stratagems`)},ft=(e,t)=>t?l(`in this pack`):e.status===`manual`?l(`by hand`):e.status===`taught`?l(`taught`):e.status===`pack`?l(`another pack`):l(`read by the app`);function pt({draft:e,onEdit:t,onPick:n}){let{armies:i,army:a,system:o,pack:s,check:c,profiles:u}=Q(e),[d,f]=(0,P.useState)(null),[p,m]=(0,P.useState)(null),h=(0,P.useMemo)(()=>a&&o?q(a.roster,o,u):[],[a,o]),g=(0,P.useMemo)(()=>!a||!o||typeof s==`string`?new Map:new Map(Qe(a.roster,s,o,u).flatMap(e=>{let t=$e(e);return t?[[`${e.kind===`stratagem`}/${e.name}`,t]]:[]})),[a,o,s]);if(typeof s==`string`)return(0,Z.jsx)(`p`,{className:`bad`,children:s});if(!a||!o)return(0,Z.jsx)(`p`,{children:l(`No army for this pack's game yet. Import a list in a game and save it to your shelf, or open an army file: it shows up here.`)});let _=h.filter(e=>e.status===`taught`).length,v=e=>g.has(`${e.kind===`stratagem`}/${e.name}`),y=n=>t(Ye(e.source,n)),b=(e,t,n)=>{let r=e.kind===`stratagem`?Ve({...n??e.stratagem,name:e.name,notYet:e.stratagem?.notYet,targetsUnit:!0},t,o):Y(e.name,t,o);y(Ue(s,e.kind,r,a.roster.army?.detachment)),f(null),m(l(`{name} is in the pack now. Save to play it on the test table.`,{name:e.name}))},x=[`ability`,`enhancement`,`army`,`detachment`,`stratagem`].filter(e=>h.some(t=>t.kind===e));return(0,Z.jsxs)(`div`,{className:`workshop-pack`,children:[(0,Z.jsxs)(`label`,{children:[l(`Build it against`),(0,Z.jsx)(`select`,{value:a.key,onChange:e=>n(e.target.value),children:i.map(e=>(0,Z.jsx)(`option`,{value:e.key,children:e.shelf?e.name:l(`{army} (sample army)`,{army:e.name})},e.key))})]}),c&&(0,Z.jsx)(mt,{check:c,total:h.length}),_>0&&(0,Z.jsx)(`p`,{children:(0,Z.jsx)(`button`,{onClick:()=>{let e=Ge(s,a.roster,o);y(e.pack),m(r(e.count,`{n} taught rule is in the pack now.`,`{n} taught rules are in the pack now.`))},children:r(_,`Put the {n} rule you taught in the pack`,`Put the {n} rules you taught in the pack`)})}),p&&(0,Z.jsx)(`p`,{className:`hint`,role:`status`,children:p}),x.map(e=>(0,Z.jsxs)(`section`,{children:[(0,Z.jsx)(`h3`,{children:dt[e]()}),(0,Z.jsx)(`ul`,{className:`pack-names`,children:h.filter(t=>t.kind===e).map(e=>{let t=v(e),n=g.get(`${e.kind===`stratagem`}/${e.name}`)??null;return(0,Z.jsxs)(`li`,{className:`pack-name ${t?`ok`:e.status}`,children:[(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`strong`,{children:e.name}),` `,(0,Z.jsx)(`span`,{className:`muted small`,children:ft(e,t)}),e.units.length>0&&(0,Z.jsxs)(`span`,{className:`muted small`,children:[` · `,e.units.join(`, `)]}),n&&(0,Z.jsxs)(`span`,{className:`small`,children:[` · ⚙ `,C(n,o)]})]}),(0,Z.jsx)(`button`,{className:`small`,onClick:()=>f(e),children:l(t?`Change`:`Build`)})]},e.name)})})]},e)),c&&c.uncovered.length>0&&(0,Z.jsxs)(`details`,{children:[(0,Z.jsx)(`summary`,{children:r(c.uncovered.length,`{n} name not covered yet`,`{n} names not covered yet`)}),(0,Z.jsx)(`p`,{className:`hint`,children:c.uncovered.map(e=>e.name).join(`, `)})]}),d&&(0,Z.jsx)(de,{name:d.name,text:d.text,auto:g.get(`${d.kind===`stratagem`}/${d.name}`)??void 0,system:o,stratagem:d.stratagem&&{name:d.name,cp:d.stratagem.cp,side:d.stratagem.side,...d.stratagem.phases?{phases:d.stratagem.phases}:{},...d.stratagem.once?{once:d.stratagem.once}:{},...d.stratagem.targetKeywords?{targetKeywords:d.stratagem.targetKeywords}:{}},onSave:(e,t)=>b(d,e,t),onClose:()=>f(null)})]})}function mt({check:e,total:t}){return(0,Z.jsxs)(`p`,{className:`hint`,children:[r(t,`The pack plays {matched} of this army's {n} name.`,`The pack plays {matched} of this army's {n} names.`,{matched:e.matched}),e.added.length>0&&` ${r(e.added.length,`It adds {n} rule the list doesn't carry.`,`It adds {n} rules the list doesn't carry.`)}`]})}function ht({draft:e,save:t}){let n=p(e=>e.session!==null),{army:r}=Q(e),[i,a]=(0,P.useState)(!1),o=async()=>{if(!r)return;let e=await t(),n=e?b.getState().packages[e]:void 0,i=n?k(n.source):null;!n||!i||`error`in i||(a(!0),await st(r,n,i),a(!1))};return(0,Z.jsx)(`button`,{onClick:()=>void o(),disabled:i||!r,title:r?l(`Play {army} with the pack on it`,{army:r.name}):void 0,children:l(i?`Setting up…`:n?`Restart the test table`:`Test table`)})}function gt({draft:e}){let[t,n]=(0,P.useState)(null),r=H(e.source);return(0,P.useEffect)(()=>{let t=!0;return g(new TextEncoder().encode(e.source)).then(e=>t&&n(e)),()=>{t=!1}},[e.source]),typeof r==`string`?(0,Z.jsx)(`p`,{children:r}):(0,Z.jsxs)(`div`,{className:`workshop-export`,children:[(0,Z.jsxs)(`p`,{children:[l(`{name} {version}`,{name:r.name,version:r.version}),t&&(0,Z.jsxs)(Z.Fragment,{children:[` · `,(0,Z.jsx)(`code`,{title:t,children:y(t)})]})]}),t&&(0,Z.jsxs)(`p`,{className:`small`,children:[`SHA-256 `,(0,Z.jsx)(`code`,{className:`pack-hash`,children:t})]}),(0,Z.jsx)(`button`,{className:`primary`,onClick:()=>w(new Blob([e.source],{type:`text/javascript`}),De(r)),children:l(`Download the pack`)}),(0,Z.jsx)(`p`,{className:`hint`,children:l(`Host the file anywhere that lets other sites read it, and share its link. Players paste the link in the army import (Faction packs); the app pins the link to this SHA-256 and asks again if the file changes. Publish only your own words: names, and what the rules do.`)})]})}var _t=`https://`,vt=(0,P.lazy)(()=>d(()=>import(`./Editor-BtW3o-WO.js`).then(e=>({default:e.Editor})),__vite__mapDeps([3,4,5,6,2,1]),import.meta.url)),yt=[{id:`skirmish`,source:ye,name:()=>l(`Skirmish`),what:()=>l(`Model by model: move, then fight.`)},{id:`ranked`,source:be,name:()=>l(`Ranked`),what:()=>l(`Regiment blocks that wheel and clash.`)},{id:`activations`,source:xe,name:()=>l(`Alternating activations`),what:()=>l(`Players take turns activating one unit each.`)},{id:`rift-lanterns`,source:se,name:()=>`Rift Lanterns`,what:()=>l(`A finished game of ours to take apart: four warbands, three missions.`)},{id:`brinewatch`,source:oe,name:()=>`Brinewatch`,what:()=>l(`Our second, to take apart: action points, guards, hidden lurkers and a campaign.`)},{id:`faction-pack`,source:Se,name:()=>l(`Faction pack`),what:()=>l(`Rules for an army's abilities, detachment and stratagems, by name, built against your own army.`)}];function bt(){let[{drafts:e,current:t},n]=(0,P.useState)(we),r=e.find(e=>e.id===t)??null,i=A(e=>e.folded),a=A(e=>e.link),o=p(e=>e.session!==null),[s,c]=(0,P.useState)(`table`),[u,f]=(0,P.useState)(null),[m,h]=(0,P.useState)(null),[g,_]=(0,P.useState)(null),[v,y]=(0,P.useState)(null),x=async()=>{if(!r||v)return;_(null),y([]);let e=await ze(r.source,y);y(null),_(e),h(e.steps.find(e=>e.ok===!1)?.line??null)},S=(e,t)=>{Te(e,t),n({drafts:e,current:t})},C=t=>{let n=Ee(t);S([...e,n],n.id);let r=H(t);typeof r!=`string`&&r.kind===`faction`&&c(`army`)},w=t=>{r&&(m!==null&&h(null),S(e.map(e=>e.id===r.id?{...e,source:t,updated:Date.now()}:e),r.id))},ee=()=>{if(!r||!confirm(l(`Delete this draft? This can't be undone.`)))return;let t=e.filter(e=>e.id!==r.id);S(t,t.at(-1)?.id??null)};(0,P.useEffect)(()=>{a&&(A.setState({link:null}),St(a).then(e=>{C(e),f({text:l(`Opened from {url}. Read it before you test it: saving runs its code in the sandbox.`,{url:a}),bad:!1})},e=>f({text:e.message,bad:!0})))},[a]);let T=(e,t=null)=>{f({text:e,bad:!0}),h(t)},E=async()=>{if(!r)return null;let t=r.source,n=U(t);if(n.length)return T(n[0]),null;let{syntaxError:i}=await d(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),a=i(t);if(a)return T(l(`Not saved: the code doesn't parse at line {line}, column {column}.`,a),a.line),null;let o=k(t),s=!(`error`in o),c;try{c=s&&!o.code?{packages:[],errors:[]}:await Ne(t)}catch(e){return T(l(`Not saved: your rules didn't load: {why}`,{why:e instanceof Error?e.message:String(e)})),null}let u=c.errors[0]?.error;if(u)return T(l(`Not saved: your rules didn't load: {why}`,{why:u}),K(t,u)),null;h(null);let m=b.getState(),g=await m.add(new TextEncoder().encode(t),{own:!0});if(!g.ok)return T(g.error),null;if(m.trust(g.pkg.hash,!0),r.saved&&r.saved!==g.pkg.hash&&m.packages[r.saved]?.own&&Tt(r.saved),S(e.map(e=>e.id===r.id?{...e,saved:g.pkg.hash}:e),r.id),s)return f({text:ct(g.pkg,o)?l(`Saved, and the pack's rules are on the army on the test table.`):l(`Saved.`),bad:!1}),g.pkg.hash;let _=Et(c);Dt(_);let v=g.pkg.manifest.systems[0],y=p.getState().game;if(p.getState().session&&y.packages?.system?.id===v){if(y.packages.packages.some(e=>e.hash===g.pkg.hash))return f({text:l(`Saved. Nothing changed for the test table.`),bad:!1}),g.pkg.hash;At(g.pkg.hash);let e=await kt();e?T(l(`Saved, but your rules didn't load on the test table: {why}`,{why:e}),K(t,e)):f({text:$.table!==null&&_!==$.table?l(`Saved and reloaded. The sample armies, missions or table changed: restart the test table to play with them.`):l(`Saved and reloaded onto the test table.`),bad:!1})}else f({text:l(`Saved.`),bad:!1});return g.pkg.hash};if(i&&o)return(0,Z.jsx)(`button`,{className:`workshop-tab`,onClick:()=>A.setState({folded:!1}),children:l(`Workshop`)});let D=r?H(r.source):null,O=typeof D!=`string`&&D?.kind===`faction`;return(0,Z.jsxs)(`section`,{className:`workshop${o?` over-table`:``}`,role:o?`complementary`:`dialog`,"aria-label":l(`Module workshop`),children:[(0,Z.jsxs)(`header`,{className:`workshop-head`,children:[(0,Z.jsx)(`h2`,{children:l(`Module workshop`)}),e.length>0&&(0,Z.jsx)(`select`,{"aria-label":l(`Draft`),value:t??``,onChange:t=>S(e,t.target.value),children:e.map(e=>{let t=H(e.source);return(0,Z.jsx)(`option`,{value:e.id,children:typeof t==`string`?l(`Untitled draft`):`${t.name} ${t.version}`},e.id)})}),(0,Z.jsx)(`span`,{className:`spacer`}),o&&(0,Z.jsxs)(`button`,{onClick:()=>A.setState({folded:!0}),title:l(`Fold the workshop to the side`),children:[`⇥ `,l(`Table`)]}),(0,Z.jsx)(`button`,{onClick:te,"aria-label":l(`Close the workshop`),children:`✕`})]}),r?(0,Z.jsxs)(`div`,{className:`workshop-body`,children:[(0,Z.jsxs)(`div`,{className:`workshop-code`,children:[(0,Z.jsxs)(`div`,{className:`workshop-tools`,children:[(0,Z.jsx)(`button`,{className:`primary`,onClick:()=>void E(),title:l(`Save (Ctrl+S)`),children:l(`Save`)}),O?(0,Z.jsx)(ht,{draft:r,save:E}):(0,Z.jsx)(jt,{save:E}),!O&&(0,Z.jsx)(`button`,{onClick:()=>void x(),disabled:!!v,title:l(`Check the types, load it, and let a bot play two rounds`),children:l(v?`Checking…`:`Check`)}),(0,Z.jsx)(`span`,{className:`spacer`}),(0,Z.jsx)(`button`,{onClick:()=>S(e,null),children:l(`New draft`)}),(0,Z.jsx)(`button`,{onClick:ee,children:l(`Delete`)})]}),u&&(0,Z.jsx)(`p`,{className:`workshop-note${u.bad?` bad`:``}`,role:u.bad?`alert`:`status`,children:u.text}),!O&&(v||g)&&(0,Z.jsx)(Ct,{steps:v??g.steps,verdict:v?null:g,stale:!!g&&g.source!==r.source,onClose:()=>_(null)}),(0,Z.jsx)(wt,{draft:r}),O&&(0,Z.jsx)(ut,{draft:r,onLine:h}),(0,Z.jsx)(P.Suspense,{fallback:(0,Z.jsx)(`div`,{className:`workshop-editor`,children:l(`Loading the editor…`)}),children:(0,Z.jsx)(vt,{doc:r.source,onChange:w,onSave:()=>void E(),label:l(`The package's code`),mark:m})})]}),(0,Z.jsxs)(`aside`,{className:`workshop-side`,children:[(0,Z.jsx)(`div`,{className:`tabs`,role:`tablist`,children:(O?[[`army`,l(`Army`)],[`table`,l(`Test table`)],[`export`,l(`Export`)]]:[[`table`,l(`Test table`)],[`soak`,l(`Soak bot`)],[`export`,l(`Export`)],[`sdk`,l(`SDK`)]]).map(([e,t])=>(0,Z.jsx)(`button`,{role:`tab`,"aria-selected":s===e,onClick:()=>c(e),children:t},e))}),s===`army`&&O&&(0,Z.jsx)(pt,{draft:r,onEdit:w,onPick:t=>S(e.map(e=>e.id===r.id?{...e,army:t}:e),r.id)}),s===`table`&&(0,Z.jsx)(Mt,{pack:O}),s===`soak`&&!O&&(0,Z.jsx)(Nt,{draft:r}),s===`export`&&O&&(0,Z.jsx)(gt,{draft:r}),s===`export`&&!O&&typeof D!=`string`&&D&&(0,Z.jsx)(Pt,{draft:r}),s===`export`&&typeof D==`string`&&(0,Z.jsx)(`p`,{children:D}),s===`sdk`&&!O&&(0,Z.jsx)(Ft,{})]})]}):(0,Z.jsx)(xt,{onPick:C})]})}function xt({onPick:e}){let[t,n]=(0,P.useState)(``),[r,i]=(0,P.useState)(null);return(0,Z.jsxs)(`div`,{className:`workshop-start`,children:[(0,Z.jsx)(`p`,{children:l(`Write a whole game as one JavaScript file: its rules as data, with code where data won't do. Start from a template; the test table plays it as you go.`)}),(0,Z.jsx)(`div`,{className:`workshop-templates`,children:yt.map(t=>(0,Z.jsxs)(`button`,{className:`workshop-template`,onClick:()=>e(t.source),children:[(0,Z.jsx)(`strong`,{children:t.name()}),(0,Z.jsx)(`span`,{children:t.what()})]},t.id))}),(0,Z.jsxs)(`form`,{className:`workshop-link`,onSubmit:n=>{n.preventDefault(),i(null),St(t).then(e,e=>i(e.message))},children:[(0,Z.jsxs)(`label`,{children:[l(`Open from a link`),(0,Z.jsx)(`input`,{type:`url`,value:t,placeholder:_t,onChange:e=>n(e.target.value),required:!0})]}),(0,Z.jsx)(`button`,{type:`submit`,children:l(`Open`)}),r&&(0,Z.jsx)(`p`,{className:`error`,children:r})]}),(0,Z.jsxs)(`p`,{children:[(0,Z.jsx)(`a`,{href:W,target:`_blank`,rel:`noreferrer`,children:l(`Community modules`)}),` · `,(0,Z.jsx)(`a`,{href:`${W.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:l(`How packages work`)})]})]})}async function St(e){let t=e.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,`https://raw.githubusercontent.com/$1/`),n;try{n=await fetch(t)}catch{throw Error(l(`Couldn't fetch that link (it may not allow other sites to read it).`))}if(!n.ok)throw Error(l(`That link answered {status}.`,{status:n.status}));let r=await n.text();if(r.length>1048576)throw Error(l(`That's too big for a module.`));let i=H(r);if(typeof i==`string`)throw Error(l(`That isn't a rules package: {why}`,{why:i}));return r}function Ct({steps:e,verdict:t,stale:n,onClose:r}){let i=t?t.ok?l(`Ready to share: nothing wrong found.`):l(`Not ready yet: {summary}`,{summary:t.summary}):l(`Checking: types, loading, then a short bot game…`);return(0,Z.jsxs)(`div`,{className:`workshop-check${t?t.ok?` ok`:` bad`:``}`,role:`status`,"aria-live":`polite`,children:[(0,Z.jsxs)(`div`,{className:`row spread`,children:[(0,Z.jsxs)(`strong`,{children:[t?t.ok?`✓ `:`✗ `:``,i]}),t&&(0,Z.jsx)(`button`,{className:`quiet`,onClick:r,title:l(`Hide`),children:`✕`})]}),n&&(0,Z.jsx)(`p`,{className:`muted small`,children:l(`The draft has changed since: check again.`)}),(0,Z.jsx)(`ul`,{children:e.map(e=>(0,Z.jsxs)(`li`,{className:e.ok===null?`skip`:e.ok?`ok`:`bad`,children:[e.ok===null?`–`:e.ok?`✓`:`✗`,` `,e.text]},e.id))})]})}function wt({draft:e}){let t=(0,P.useMemo)(()=>U(e.source),[e.source]),n=M(e=>e.error),r=p(e=>e.session!==null),i=[...t,...r&&n?[n]:[]];return i.length?(0,Z.jsx)(`ul`,{className:`workshop-problems`,"aria-label":l(`Problems`),children:i.map(e=>(0,Z.jsxs)(`li`,{children:[`⚠ `,e]},e))}):null}function Tt(e){let t=()=>p.getState().game.packages?.packages.some(t=>t.hash===e)??!1;if(!t())return b.getState().remove(e);let n=p.subscribe(()=>{t()||(n(),b.getState().remove(e))})}function Et(e){let t=e.packages[0]?.provides?.app;return JSON.stringify(t?[t.samples,t.armies,t.missions,t.layout]:null)}var $={table:null,last:null},Dt=e=>void($.last=e),Ot=()=>void($.table=$.last);function kt(){return new Promise(e=>{let t=M.getState().status===`starting`,n=t=>{r(),clearTimeout(i),e(t)},r=M.subscribe(e=>{e.status===`starting`?t=!0:t&&n(e.status===`on`?e.error:e.error??l(`the rules stopped`))}),i=setTimeout(()=>n(null),1e4)})}function At(e){let t=b.getState().packages[e];t&&p.getState().dispatch({type:`game/packages`,app:m,system:{id:t.manifest.systems[0],builtIn:!1},packages:[ne(t)]})}function jt({save:e}){let t=p(e=>e.session!==null),[n,r]=(0,P.useState)(!1),i=async()=>{let t=await e();Ot();let n=t?b.getState().packages[t]:void 0;if(!n)return;r(!0);let i=p.getState();i.session&&(i.session.leave(),p.setState({session:null,role:null,scrub:null,selected:null,draft:null}));let o=n.manifest.systems[0];p.getState().start({role:`host`,mode:`hotseat`,name:localStorage.getItem(`open-battle:name`)??``,system:o}),At(n.hash);let s=0,c=()=>{let{game:e,dispatch:t}=p.getState(),n=M.getState();if(n.status===`stopped`)return r(!1);if(n.status!==`on`||!f(o)||e.system!==o||a(e).length<2){s++<200?setTimeout(c,50):r(!1);return}O.initial=p.getState().record.initial,D(()=>p.getState().game,t,crypto.randomUUID().slice(0,6)),p.getState().dispatch({type:`turn/next`}),r(!1)};c()};return(0,Z.jsx)(`button`,{onClick:()=>void i(),disabled:n,children:l(n?`Setting up…`:t?`Restart the test table`:`Test table`)})}function Mt({pack:e}){let t=p(e=>e.session!==null),n=M(e=>e.status),i=M(e=>e.error),a=p(e=>e.record),o=ue(),s=(0,P.useMemo)(()=>t?S(a).filter(e=>e.kind===`line`&&!e.undone).slice(-12).reverse():[],[t,a]);return t?(0,Z.jsxs)(`div`,{className:`workshop-table`,children:[(0,Z.jsxs)(`p`,{className:i&&n!==`starting`?`bad`:void 0,children:[l(e&&n!==`starting`&&!i?`Your army is on the table with the pack on it.`:n===`on`&&!i?`Your rules are running.`:n===`starting`?`Starting your rules…`:`Your rules aren't running.`),i&&n!==`starting`&&(0,Z.jsxs)(Z.Fragment,{children:[` `,i]})]}),(0,Z.jsx)(`p`,{children:(0,Z.jsx)(`button`,{onClick:le,children:r(o.length,`{n} table warning`,`{n} table warnings`,{n:o.length})})}),(0,Z.jsx)(`h3`,{children:l(`Dice and log`)}),(0,Z.jsx)(`ol`,{className:`workshop-log`,children:s.map(e=>(0,Z.jsx)(`li`,{children:e.kind===`line`?e.text:``},e.key))})]}):(0,Z.jsx)(`p`,{children:l(e?`Test table starts a game on this screen: the army you build against, with the pack on it, against a sample army. Every save puts the pack's new rules on it.`:`Test table starts a game of your draft on this screen with each side's sample army. Every save reloads it there.`)})}function Nt({draft:e}){let[t,n]=(0,P.useState)([]),[r,i]=(0,P.useState)(!1),a=async()=>{i(!0),n([]),await Me(e.source,[1,2,3],e=>n(t=>[...t,e])),i(!1)};return(0,Z.jsxs)(`div`,{className:`workshop-soak`,children:[(0,Z.jsx)(`p`,{children:l(`The soak bot plays whole games of your draft with random legal moves, over pretend peers, and checks every table stays the same and nothing throws.`)}),(0,Z.jsx)(`button`,{onClick:()=>void a(),disabled:r||U(e.source).length>0,children:l(r?`Playing…`:`Play 3 bot games`)}),(0,Z.jsx)(`ul`,{children:t.map(e=>(0,Z.jsx)(`li`,{className:e.ok?`ok`:`bad`,children:e.ok?e.finished?l(`Game {seed}: fine, played to the end in {steps} moves.`,{seed:e.seed,steps:e.steps}):l(`Game {seed}: fine for {steps} moves, stopped in round {round}.`,{seed:e.seed,steps:e.steps,round:e.round}):l(`Game {seed} went wrong: {why}`,{seed:e.seed,why:e.failures[0]??``})},e.seed))})]})}function Pt({draft:e}){let[t,n]=(0,P.useState)(null),[r,i]=(0,P.useState)(``),[a,o]=(0,P.useState)(!1),s=H(e.source);return(0,P.useEffect)(()=>{let t=!0;return crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e.source)).then(e=>{t&&n(Array.from(new Uint8Array(e)).map(e=>e.toString(16).padStart(2,`0`)).join(``))}),()=>{t=!1}},[e.source]),typeof s==`string`?(0,Z.jsx)(`p`,{children:s}):(0,Z.jsxs)(`div`,{className:`workshop-export`,children:[(0,Z.jsxs)(`p`,{children:[l(`{name} {version}`,{name:s.name,version:s.version}),t&&(0,Z.jsxs)(Z.Fragment,{children:[` · `,(0,Z.jsx)(`code`,{title:t,children:y(t)})]})]}),(0,Z.jsx)(`button`,{className:`primary`,onClick:()=>{w(new Blob([e.source],{type:`text/javascript`}),De(s))},children:l(`Download the package`)}),(0,Z.jsx)(`p`,{className:`hint`,children:l(`Players load the file in Rules packages; peers check they have the same bytes by this fingerprint.`)}),(0,Z.jsx)(`h3`,{children:l(`Share it in the gallery`)}),(0,Z.jsx)(`p`,{className:`hint`,children:l(`To host it: make a gist at gist.github.com, paste the file in, save, and copy its Raw link. A file in a GitHub repository works too (its Raw button).`)}),(0,Z.jsxs)(`label`,{children:[l(`Where the file is hosted (a raw link)`),(0,Z.jsx)(`input`,{type:`url`,value:r,placeholder:_t,onChange:e=>i(e.target.value)})]}),(0,Z.jsx)(`button`,{disabled:!t,onClick:()=>void navigator.clipboard.writeText(Ae(s,t,r)).then(()=>{o(!0),setTimeout(()=>o(!1),2e3)}),children:l(a?`Copied`:`Copy the pull request text`)}),` `,(0,Z.jsx)(`a`,{href:ke,target:`_blank`,rel:`noreferrer`,children:l(`Edit the gallery on GitHub`)})]})}function Ft(){let e=(e,t)=>(0,Z.jsxs)(Z.Fragment,{children:[(0,Z.jsx)(`h3`,{children:e}),(0,Z.jsx)(`dl`,{className:`workshop-ref`,children:t.map(e=>(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`dt`,{children:(0,Z.jsxs)(`code`,{children:[e.label,e.detail&&e.detail!==`snippet`?` ${e.detail}`:``]})}),(0,Z.jsx)(`dd`,{children:typeof e.info==`string`?e.info:``})]},e.label))})]});return(0,Z.jsxs)(`div`,{className:`workshop-sdk`,children:[(0,Z.jsx)(`p`,{children:l(`Everything a package can use. In the editor, type ctx. or view. for suggestions.`)}),e(l(`Commands a rule yields (ctx.)`),fe),e(l(`The game as it stands (view.)`),pe),e(l(`Keys and snippets`),me),(0,Z.jsx)(`p`,{children:(0,Z.jsx)(`a`,{href:`${W.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:l(`How packages work`)})}),(0,Z.jsxs)(`details`,{children:[(0,Z.jsx)(`summary`,{children:l(`The full types`)}),(0,Z.jsx)(`pre`,{children:ve})]})]})}export{bt as Workshop,he as n,V as t};