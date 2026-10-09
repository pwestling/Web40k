const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./syntax-CEL_Wvla.js","./dist-YYVtoirG.js","./dist-lgRNSFRF.js","./Editor-lKHQV5Y0.js","./rolldown-runtime-hePW80VL.js","./react-Cvdyeg_0.js","./jsx-runtime-NZYk81nU.js"])))=>i.map(i=>d[i]);
import{r as e}from"./rolldown-runtime-hePW80VL.js";import{t}from"./react-Cvdyeg_0.js";import{Yn as n,fn as r,qn as i}from"./core-C4NdfLVC.js";import{t as a}from"./preload-helper-BaNbYf_w.js";import{A as o,Et as s,Tt as c,kt as l,x as u}from"./store-DdXhK_Wn.js";import{t as d}from"./gameLog-D5k3Aj0I.js";import{n as f}from"./files-CdfAAl3C.js";import{a as p,s as m}from"./Packages-CeMSsWLb.js";import{t as h}from"./jsx-runtime-NZYk81nU.js";import{n as g}from"./setup-D9ulv--S.js";import{n as _}from"./showcase-BT2mg1sx.js";import{i as v,r as ee}from"./index-CLrAHLZ2.js";import y from"./rift-lanterns-DLDKmR7R.js";import{_ as b,a as x,i as S,v as C}from"./TableWarnings-Bo0AUsn8.js";import{s as w}from"./dist-lgRNSFRF.js";var T=e(t(),1),E=(e,t,n)=>({label:e,detail:t,info:n,type:`function`}),D=(e,t,n)=>({label:e,detail:t,info:n,type:`property`}),O=[D(`view`,`: GameView`,`The game as it stands: units, distances, line of sight.`),E(`roll`,`(dice, label?, unitId?, need?)`,'Roll dice with the host\'s dice, e.g. ctx.roll("3d6", "hits", unitId, 4). With `need`, each die of that score or more is a success.'),E(`note`,`(text)`,`A line in the game log.`),E(`ask`,`(player, question, options)`,`Ask a player to choose; the result is the option id.`),E(`run`,`(procedure, roles)`,`Run one of the system's data procedures to the end; the result says what each step rolled.`),E(`emit`,`(event)`,`Change the table with an event, e.g. { type: "model/wounds", id, woundsLost, destroyed }.`),E(`set`,`(key, value)`,`Remember a value for this player's package (read back from view.own[key]).`),E(`secret`,`(player, key, question, options)`,`A choice kept on the player's device; only a commitment goes on the table.`),E(`reveal`,`(player, key)`,`Have a player reveal a secret they committed.`)],k=[D(`round`,`: number`,`The battle round (0 while setting up).`),D(`phase`,`: string | null`,`The current phase's id.`),D(`activePlayer`,`: string | null`,`Whose turn it is.`),E(`unit`,`(id)`,`A unit by id.`),E(`units`,`(player?)`,`Every unit, or one player's.`),E(`distance`,`(a, b)`,`Closest distance between two units' bases, in the system's units.`),E(`visible`,`(from, to)`,`Whether a unit can see another.`),E(`inCover`,`(from, to)`,`Whether the target is in cover from the shooter.`),E(`arc`,`(of, other)`,`Which arc of a unit another is in (front, flank, rear), for ranked games.`),E(`engaged`,`(unitId)`,`Enemy units this one is engaged with.`),D(`own`,`: Record<string, unknown>`,`This player's package values (ctx.set).`),D(`state`,`: GameState`,`The whole game state, read-only.`)],A=[D(`id`,`manifest / module / action`,`A stable id: a package's must stay the same across versions.`),D(`name`,`manifest / action`,`What players see.`),D(`version`,`manifest / module`,`Semantic version, e.g. 0.1.0.`),D(`author`,`manifest`,`Who wrote it.`),D(`api`,`manifest / module`,`The SDK version: 1.`),D(`kind`,`manifest`,`"system" for a whole game, "extension" for additions to one.`),D(`systems`,`manifest`,`The system ids it brings or changes.`),D(`requires`,`manifest`,`Other packages it needs.`),D(`adds`,`manifest`,`One line on what it adds, shown before a player trusts it.`),D(`system`,`module`,`The rules as data: characteristics, dice, the turn (src/core/content/schema.ts).`),D(`app`,`module`,`The app glue: sample armies, the table layout, rank rules, a side panel.`),D(`actions`,`module`,`Code actions: buttons on a unit card or for a player.`),D(`procedures`,`module`,`Named generator procedures, run by data or by ctx.run.`),D(`hooks`,`module`,`Turn hooks: phaseStart, phaseEnd, roundStart, activationEnd.`),D(`functions`,`module`,`Pure functions data rules can call.`),D(`checks`,`module`,`(view) => warnings for the table warnings panel.`),D(`by`,`action`,`"unit" or "player".`),D(`phases`,`action`,`Phase ids it's offered in (an alternate's id for activations).`),E(`available`,`(view, actor)`,`true, or why not.`),E(`targets`,`(view, actor)`,`The targets to pick from: { unitId, label }.`),E(`run`,`function* (ctx, args)`,`What it does: yield ctx commands.`),E(`sample`,`(seat)`,`The test table's army for a seat.`),E(`layout`,`(table)`,`Terrain, objectives and deployment zones.`),E(`sidePanel`,`(view)`,`A panel of lines and buttons, or null.`),D(`armies`,`app`,`Every sample army players pick from, one per faction.`),D(`missions`,`app`,`Missions picked at setup: zones, objectives and scoring.`),D(`templateCategory`,`app`,`What each terrain template counts as, e.g. { Woods: "cover" }.`),D(`phaseStart`,`hooks`,`{ [phaseId]: function* (ctx) }`),D(`phaseEnd`,`hooks`,`{ [phaseId]: function* (ctx) }`),E(`roundStart`,`function* (ctx)`,`At the start of each round.`),E(`activationEnd`,`function* (ctx)`,`When a unit's activation ends.`),w(`{
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
}`,{label:`mission`,detail:`snippet`,info:`A mission: setup and scoring.`,type:`keyword`}),w('{ template: "${Ruin}", id: "${id}", position: { x: ${0}, y: ${0} }, facing: 0 }',{label:`terrain`,detail:`snippet`,info:`A terrain piece from a template (Ruin, Small ruin, Tall ruin, Container, Woods, Barricade, Crater, Hill).`,type:`keyword`}),w('look: { shape: "${trooper}", color: "${#8a6bb8}" }',{label:`look`,detail:`snippet`,info:`A model's stand-in figure: trooper, brute, robed, beast, walker, drone or vehicle.`,type:`keyword`}),w('(view) => [{ unitId: ${id}, message: "${what is wrong}", severity: "warning" }]',{label:`check`,detail:`snippet`,info:`A table warning.`,type:`keyword`})];function te(e){let t=e.matchBefore(/\b(ctx|view)\.\w*$/);if(t){let e=t.text.indexOf(`.`);return{from:t.from+e+1,options:t.text.startsWith(`ctx`)?O:k,validFor:/^\w*$/}}let n=e.matchBefore(/\w+$/);return!n&&!e.explicit||n&&e.state.sliceDoc(n.from-1,n.from)===`.`?null:{from:n?.from??e.pos,options:A,validFor:/^\w*$/}}var j=null,M=!1,ne=1,N=new Map;function re(){if(j||M)return j;try{j=new Worker(new URL(new URL(`typesWorker-MCR94-Ye.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`workshop-types`})}catch{return M=!0,null}return j.onmessage=e=>{N.get(e.data.id)?.(e.data.result),N.delete(e.data.id)},j.onerror=()=>{M=!0,j?.terminate(),j=null;for(let e of N.values())e(null);N.clear()},j}function P(e){let t=re();if(!t)return Promise.resolve(null);let n=ne++;return new Promise(r=>{N.set(n,e=>r(e)),t.postMessage({...e,id:n})})}var F={problems:async e=>await P({t:`problems`,source:e})??[],hover:(e,t)=>P({t:`hover`,source:e,pos:t}),complete:async(e,t)=>await P({t:`complete`,source:e,pos:t})??[],detail:(e,t,n)=>P({t:`detail`,source:e,pos:t,name:n}),available:()=>!M},ie=`import type { GameSystem, Id } from "../core/content/schema";
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
  /** Extra to add to the judgement, from \`seat\`'s side (a module's own sense of what matters). */
  evaluate?(state: GameState, seat: number): number;
  /** Inches a unit moves in a straight move it makes by hand, when there's no move action. */
  moveInches?(state: GameState, unit: Unit): number;
  /** How much it fears enemies in reach of its units (default 0.3; 0 turns it off). */
  threat?: number;
  /**
   * What the whole-turn planner (#51) plays after its own turn: the enemy's
   * whole turn, greedily ("turn", the default), or only their guns ("shots").
   */
  planReply?: "turn" | "shots";
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
}
`,ae=`// A starter game for the module workshop: a skirmish game, model by model.
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
`,oe=`// A starter game for the module workshop: rank-and-flank regiments that move
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
`,se=`// A starter game for the module workshop: alternating activations. Players
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
`,I=`open-battle:workshop`;function ce(){try{let e=JSON.parse(localStorage.getItem(I)??`null`);if(e&&Array.isArray(e.drafts))return e}catch{}return{drafts:[],current:null}}function le(e,t){try{localStorage.setItem(I,JSON.stringify({drafts:e,current:t}))}catch{}}function ue(e){return{id:crypto.randomUUID().slice(0,8),source:e,updated:Date.now()}}function L(e){let t=l(e);return`error`in t?t.error:t.manifest}function R(e){let t=L(e);if(typeof t==`string`)return[t];let n=[];return t.kind!==`system`&&n.push(`The workshop tests whole games: set manifest.kind to "system".`),t.systems[0]||n.push(`Name the game's system id in manifest.systems.`),/export\s+default\b/.test(e)||n.push(`Export the game: export default { module }.`),n}function de(e){return`${e.id.replace(/[^\w.-]+/g,`-`)}-${e.version}.js`}var z=`https://github.com/pwestling/Web40k`,B=`${z}/blob/main/docs/community-modules.md`,fe=`${z}/edit/main/docs/community-modules.md`;function V(e,t,n){let r=n||`<the module's raw URL>`;return[`## Add ${e.name} ${e.version} to the community modules`,``,e.adds??``,``,`Row for docs/community-modules.md:`,``,"```",`| [${e.name}](${r}) | ${e.version} | ${e.author??``} | ${e.systems.join(`, `)} | ${e.adds??``} | \`${t.slice(0,16)}\` |`,"```",``,`- Package id: \`${e.id}\` (kind: ${e.kind})`,`- SHA-256: \`${t}\``,`- Tested in the module workshop: the test table and the soak bot.`,`- No Games Workshop text, names or stats in the file.`].join(`
`)}var pe=12e4;async function H(e,t,n,r){let i=null,o;try{let e=(await a(async()=>{let{default:e}=await import(`./_virtual_soak-worker-BDi617iI.js`);return{default:e}},[],import.meta.url)).default;o=await C.start(e,e=>i=e)}catch(e){let r=e instanceof Error?e.message:String(e);for(let e of t)n({seed:e,ok:!1,failures:[r],steps:0,round:0,finished:!1});return}try{for(let a of t)try{n(await o.call({t:`soak`,source:e,seed:a,...r===void 0?{}:{untilRound:r}},pe))}catch(e){if(n({seed:a,ok:!1,failures:[i??(e instanceof Error?e.message:String(e))],steps:0,round:0,finished:!1}),i)return}}finally{o.stop()}}var U=null;async function W(e){U??=(async()=>{let e=(await a(async()=>{let{default:e}=await import(`./_virtual_soak-worker-BDi617iI.js`);return{default:e}},[],import.meta.url)).default;return C.start(e,()=>U=null)})();try{return await(await U).call({t:`check`,source:e},me)}catch(e){throw U=null,e}}var me=5e3;function he(e,t){let n=(/^system\.([\w.[\]]+)/.exec(t)?.[1])?.replace(/\[\d+\]/g,``).split(`.`).at(-1);if(!n)return null;let r=e.search(/\bconst\s+system\b|\bsystem\s*[:=]\s*{/),i=e.slice(Math.max(0,r)).search(RegExp(`\\b${n}\\s*:`));return i<0?null:e.slice(0,Math.max(0,r)+i).split(`
`).length}function ge(e){let t=[];for(let r of e)r.ok===!1&&(r.id===`code`?t.push(r.text):r.id===`types`?t.push(n(r.count??1,`{n} type problem`,`{n} type problems`)):r.id===`load`?t.push(i(`it doesn't load`)):t.push(i(`the bot game went wrong`)));return t.join(`, `)}var G=2,K=(e,t)=>e.slice(0,t).split(`
`).length;function q(e,t){let n=/line (\d+)/.exec(t);return n?Number(n[1]):he(e,t)}async function _e(e,t){let r=[],o=()=>t([...r]),s=()=>({ok:r.every(e=>e.ok!==!1),source:e,steps:r,summary:ge(r)}),c=R(e),{syntaxError:l}=await a(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),u=l(e);if(c.length||u)return r.push({id:`code`,ok:!1,text:c[0]??i(`The code doesn't parse at line {line}, column {column}.`,u),line:u?.line??null}),s();let[d,f]=await Promise.all([F.available()?F.problems(e):Promise.resolve(null),W(e).then(e=>e.errors[0]?.error??null,e=>e instanceof Error?e.message:String(e))]),p=d?.filter(e=>e.severity===`error`)??[];if(r.push(d===null?{id:`types`,ok:null,text:i(`Types: the type checker isn't available here.`),line:null}:p.length?{id:`types`,ok:!1,text:n(p.length,`Types: {n} problem. Line {line}: {message}`,`Types: {n} problems. The first, line {line}: {message}`,{line:K(e,p[0].from),message:p[0].message}),line:K(e,p[0].from),count:p.length}:{id:`types`,ok:!0,text:i(`Types: everything matches the SDK.`),line:null}),r.push(f?{id:`load`,ok:!1,text:i(`Loading: {why}`,{why:f}),line:q(e,f)}:{id:`load`,ok:!0,text:i(`Loading: it loads, and its system has the right shape.`),line:null}),o(),f)return r.push({id:`soak`,ok:null,text:i(`Bot game: not played, since it doesn't load.`),line:null}),s();let m=null;await H(e,[1],e=>m=e,G);let h=m;return r.push(h?h.ok?{id:`soak`,ok:!0,text:h.finished?i(`Bot game: played to the end in {steps} moves.`,{steps:h.steps}):i(`Bot game: {rounds} rounds in {steps} moves, with nothing wrong.`,{rounds:G,steps:h.steps}),line:null}:{id:`soak`,ok:!1,text:i(`Bot game: {why}`,{why:h.failures[0]??``}),line:q(e,h.failures[0]??``)}:{id:`soak`,ok:!1,text:i(`Bot game: it didn't report back.`),line:null}),s()}var J=h(),Y=`https://`,ve=(0,T.lazy)(()=>a(()=>import(`./Editor-lKHQV5Y0.js`).then(e=>({default:e.Editor})),__vite__mapDeps([3,4,5,6,2,1]),import.meta.url)),ye=[{id:`skirmish`,source:ae,name:()=>i(`Skirmish`),what:()=>i(`Model by model: move, then fight.`)},{id:`ranked`,source:oe,name:()=>i(`Ranked`),what:()=>i(`Regiment blocks that wheel and clash.`)},{id:`activations`,source:se,name:()=>i(`Alternating activations`),what:()=>i(`Players take turns activating one unit each.`)},{id:`rift-lanterns`,source:y,name:()=>`Rift Lanterns`,what:()=>i(`A finished game of ours to take apart: four warbands, three missions.`)}];function be(){let[{drafts:e,current:t},n]=(0,T.useState)(ce),r=e.find(e=>e.id===t)??null,o=v(e=>e.folded),s=v(e=>e.link),l=u(e=>e.session!==null),[d,f]=(0,T.useState)(`table`),[p,m]=(0,T.useState)(null),[h,g]=(0,T.useState)(null),[_,y]=(0,T.useState)(null),[b,x]=(0,T.useState)(null),S=async()=>{if(!r||b)return;y(null),x([]);let e=await _e(r.source,x);x(null),y(e),g(e.steps.find(e=>e.ok===!1)?.line??null)},C=(e,t)=>{le(e,t),n({drafts:e,current:t})},w=t=>{let n=ue(t);C([...e,n],n.id)},E=t=>{r&&(h!==null&&g(null),C(e.map(e=>e.id===r.id?{...e,source:t,updated:Date.now()}:e),r.id))},D=()=>{if(!r||!confirm(i(`Delete this draft? This can't be undone.`)))return;let t=e.filter(e=>e.id!==r.id);C(t,t.at(-1)?.id??null)};(0,T.useEffect)(()=>{s&&(v.setState({link:null}),X(s).then(e=>{w(e),m({text:i(`Opened from {url}. Read it before you test it: saving runs its code in the sandbox.`,{url:s}),bad:!1})},e=>m({text:e.message,bad:!0})))},[s]);let O=(e,t=null)=>{m({text:e,bad:!0}),g(t)},k=async()=>{if(!r)return null;let t=r.source,n=R(t);if(n.length)return O(n[0]),null;let{syntaxError:o}=await a(async()=>{let{syntaxError:e}=await import(`./syntax-CEL_Wvla.js`);return{syntaxError:e}},__vite__mapDeps([0,1,2]),import.meta.url),s=o(t);if(s)return O(i(`Not saved: the code doesn't parse at line {line}, column {column}.`,s),s.line),null;let l;try{l=await W(t)}catch(e){return O(i(`Not saved: your rules didn't load: {why}`,{why:e instanceof Error?e.message:String(e)})),null}let d=l.errors[0]?.error;if(d)return O(i(`Not saved: your rules didn't load: {why}`,{why:d}),q(t,d)),null;g(null);let f=c.getState(),p=await f.add(new TextEncoder().encode(t),{own:!0});if(!p.ok)return O(p.error),null;f.trust(p.pkg.hash,!0),r.saved&&r.saved!==p.pkg.hash&&f.packages[r.saved]?.own&&Ce(r.saved),C(e.map(e=>e.id===r.id?{...e,saved:p.pkg.hash}:e),r.id);let h=we(l);Te(h);let _=p.pkg.manifest.systems[0],v=u.getState().game;if(u.getState().session&&v.packages?.system?.id===_){if(v.packages.packages.some(e=>e.hash===p.pkg.hash))return m({text:i(`Saved. Nothing changed for the test table.`),bad:!1}),p.pkg.hash;$(p.pkg.hash);let e=await De();e?O(i(`Saved, but your rules didn't load on the test table: {why}`,{why:e}),q(t,e)):m({text:Q.table!==null&&h!==Q.table?i(`Saved and reloaded. The sample armies, missions or table changed: restart the test table to play with them.`):i(`Saved and reloaded onto the test table.`),bad:!1})}else m({text:i(`Saved.`),bad:!1});return p.pkg.hash};if(o&&l)return(0,J.jsx)(`button`,{className:`workshop-tab`,onClick:()=>v.setState({folded:!1}),children:i(`Workshop`)});let A=r?L(r.source):null;return(0,J.jsxs)(`section`,{className:`workshop${l?` over-table`:``}`,role:l?`complementary`:`dialog`,"aria-label":i(`Module workshop`),children:[(0,J.jsxs)(`header`,{className:`workshop-head`,children:[(0,J.jsx)(`h2`,{children:i(`Module workshop`)}),e.length>0&&(0,J.jsx)(`select`,{"aria-label":i(`Draft`),value:t??``,onChange:t=>C(e,t.target.value),children:e.map(e=>{let t=L(e.source);return(0,J.jsx)(`option`,{value:e.id,children:typeof t==`string`?i(`Untitled draft`):`${t.name} ${t.version}`},e.id)})}),(0,J.jsx)(`span`,{className:`spacer`}),l&&(0,J.jsxs)(`button`,{onClick:()=>v.setState({folded:!0}),title:i(`Fold the workshop to the side`),children:[`⇥ `,i(`Table`)]}),(0,J.jsx)(`button`,{onClick:ee,"aria-label":i(`Close the workshop`),children:`✕`})]}),r?(0,J.jsxs)(`div`,{className:`workshop-body`,children:[(0,J.jsxs)(`div`,{className:`workshop-code`,children:[(0,J.jsxs)(`div`,{className:`workshop-tools`,children:[(0,J.jsx)(`button`,{className:`primary`,onClick:()=>void k(),title:i(`Save (Ctrl+S)`),children:i(`Save`)}),(0,J.jsx)(Oe,{save:k}),(0,J.jsx)(`button`,{onClick:()=>void S(),disabled:!!b,title:i(`Check the types, load it, and let a bot play two rounds`),children:i(b?`Checking…`:`Check`)}),(0,J.jsx)(`span`,{className:`spacer`}),(0,J.jsx)(`button`,{onClick:()=>C(e,null),children:i(`New draft`)}),(0,J.jsx)(`button`,{onClick:D,children:i(`Delete`)})]}),p&&(0,J.jsx)(`p`,{className:`workshop-note${p.bad?` bad`:``}`,role:p.bad?`alert`:`status`,children:p.text}),(b||_)&&(0,J.jsx)(Se,{steps:b??_.steps,verdict:b?null:_,stale:!!_&&_.source!==r.source,onClose:()=>y(null)}),(0,J.jsx)(Z,{draft:r}),(0,J.jsx)(T.Suspense,{fallback:(0,J.jsx)(`div`,{className:`workshop-editor`,children:i(`Loading the editor…`)}),children:(0,J.jsx)(ve,{doc:r.source,onChange:E,onSave:()=>void k(),label:i(`The package's code`),mark:h})})]}),(0,J.jsxs)(`aside`,{className:`workshop-side`,children:[(0,J.jsx)(`div`,{className:`tabs`,role:`tablist`,children:[[`table`,i(`Test table`)],[`soak`,i(`Soak bot`)],[`export`,i(`Export`)],[`sdk`,i(`SDK`)]].map(([e,t])=>(0,J.jsx)(`button`,{role:`tab`,"aria-selected":d===e,onClick:()=>f(e),children:t},e))}),d===`table`&&(0,J.jsx)(ke,{}),d===`soak`&&(0,J.jsx)(Ae,{draft:r}),d===`export`&&typeof A!=`string`&&A&&(0,J.jsx)(je,{draft:r}),d===`export`&&typeof A==`string`&&(0,J.jsx)(`p`,{children:A}),d===`sdk`&&(0,J.jsx)(Me,{})]})]}):(0,J.jsx)(xe,{onPick:w})]})}function xe({onPick:e}){let[t,n]=(0,T.useState)(``),[r,a]=(0,T.useState)(null);return(0,J.jsxs)(`div`,{className:`workshop-start`,children:[(0,J.jsx)(`p`,{children:i(`Write a whole game as one JavaScript file: its rules as data, with code where data won't do. Start from a template; the test table plays it as you go.`)}),(0,J.jsx)(`div`,{className:`workshop-templates`,children:ye.map(t=>(0,J.jsxs)(`button`,{className:`workshop-template`,onClick:()=>e(t.source),children:[(0,J.jsx)(`strong`,{children:t.name()}),(0,J.jsx)(`span`,{children:t.what()})]},t.id))}),(0,J.jsxs)(`form`,{className:`workshop-link`,onSubmit:n=>{n.preventDefault(),a(null),X(t).then(e,e=>a(e.message))},children:[(0,J.jsxs)(`label`,{children:[i(`Open from a link`),(0,J.jsx)(`input`,{type:`url`,value:t,placeholder:Y,onChange:e=>n(e.target.value),required:!0})]}),(0,J.jsx)(`button`,{type:`submit`,children:i(`Open`)}),r&&(0,J.jsx)(`p`,{className:`error`,children:r})]}),(0,J.jsxs)(`p`,{children:[(0,J.jsx)(`a`,{href:B,target:`_blank`,rel:`noreferrer`,children:i(`Community modules`)}),` · `,(0,J.jsx)(`a`,{href:`${B.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:i(`How packages work`)})]})]})}async function X(e){let t=e.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,`https://raw.githubusercontent.com/$1/`),n;try{n=await fetch(t)}catch{throw Error(i(`Couldn't fetch that link (it may not allow other sites to read it).`))}if(!n.ok)throw Error(i(`That link answered {status}.`,{status:n.status}));let r=await n.text();if(r.length>1048576)throw Error(i(`That's too big for a module.`));let a=L(r);if(typeof a==`string`)throw Error(i(`That isn't a rules package: {why}`,{why:a}));return r}function Se({steps:e,verdict:t,stale:n,onClose:r}){let a=t?t.ok?i(`Ready to share: nothing wrong found.`):i(`Not ready yet: {summary}`,{summary:t.summary}):i(`Checking: types, loading, then a short bot game…`);return(0,J.jsxs)(`div`,{className:`workshop-check${t?t.ok?` ok`:` bad`:``}`,role:`status`,"aria-live":`polite`,children:[(0,J.jsxs)(`div`,{className:`row spread`,children:[(0,J.jsxs)(`strong`,{children:[t?t.ok?`✓ `:`✗ `:``,a]}),t&&(0,J.jsx)(`button`,{className:`quiet`,onClick:r,title:i(`Hide`),children:`✕`})]}),n&&(0,J.jsx)(`p`,{className:`muted small`,children:i(`The draft has changed since: check again.`)}),(0,J.jsx)(`ul`,{children:e.map(e=>(0,J.jsxs)(`li`,{className:e.ok===null?`skip`:e.ok?`ok`:`bad`,children:[e.ok===null?`–`:e.ok?`✓`:`✗`,` `,e.text]},e.id))})]})}function Z({draft:e}){let t=(0,T.useMemo)(()=>R(e.source),[e.source]),n=b(e=>e.error),r=u(e=>e.session!==null),a=[...t,...r&&n?[n]:[]];return a.length?(0,J.jsx)(`ul`,{className:`workshop-problems`,"aria-label":i(`Problems`),children:a.map(e=>(0,J.jsxs)(`li`,{children:[`⚠ `,e]},e))}):null}function Ce(e){let t=()=>u.getState().game.packages?.packages.some(t=>t.hash===e)??!1;if(!t())return c.getState().remove(e);let n=u.subscribe(()=>{t()||(n(),c.getState().remove(e))})}function we(e){let t=e.packages[0]?.provides?.app;return JSON.stringify(t?[t.samples,t.armies,t.missions,t.layout]:null)}var Q={table:null,last:null},Te=e=>void(Q.last=e),Ee=()=>void(Q.table=Q.last);function De(){return new Promise(e=>{let t=b.getState().status===`starting`,n=t=>{r(),clearTimeout(a),e(t)},r=b.subscribe(e=>{e.status===`starting`?t=!0:t&&n(e.status===`on`?e.error:e.error??i(`the rules stopped`))}),a=setTimeout(()=>n(null),1e4)})}function $(e){let t=c.getState().packages[e];t&&u.getState().dispatch({type:`game/packages`,app:m,system:{id:t.manifest.systems[0],builtIn:!1},packages:[p(t)]})}function Oe({save:e}){let t=u(e=>e.session!==null),[n,a]=(0,T.useState)(!1),s=async()=>{let t=await e();Ee();let n=t?c.getState().packages[t]:void 0;if(!n)return;a(!0);let i=u.getState();i.session&&(i.session.leave(),u.setState({session:null,role:null,scrub:null,selected:null,draft:null}));let s=n.manifest.systems[0];u.getState().start({role:`host`,mode:`hotseat`,name:localStorage.getItem(`open-battle:name`)??``,system:s}),$(n.hash);let l=0,d=()=>{let{game:e,dispatch:t}=u.getState(),n=b.getState();if(n.status===`stopped`)return a(!1);if(n.status!==`on`||!o(s)||e.system!==s||r(e).length<2){l++<200?setTimeout(d,50):a(!1);return}_.initial=u.getState().record.initial,g(()=>u.getState().game,t,crypto.randomUUID().slice(0,6)),u.getState().dispatch({type:`turn/next`}),a(!1)};d()};return(0,J.jsx)(`button`,{onClick:()=>void s(),disabled:n,children:i(n?`Setting up…`:t?`Restart the test table`:`Test table`)})}function ke(){let e=u(e=>e.session!==null),t=b(e=>e.status),r=b(e=>e.error),a=u(e=>e.record),o=x(),s=(0,T.useMemo)(()=>e?d(a).filter(e=>e.kind===`line`&&!e.undone).slice(-12).reverse():[],[e,a]);return e?(0,J.jsxs)(`div`,{className:`workshop-table`,children:[(0,J.jsxs)(`p`,{className:r&&t!==`starting`?`bad`:void 0,children:[i(t===`on`&&!r?`Your rules are running.`:t===`starting`?`Starting your rules…`:`Your rules aren't running.`),r&&t!==`starting`&&(0,J.jsxs)(J.Fragment,{children:[` `,r]})]}),(0,J.jsx)(`p`,{children:(0,J.jsx)(`button`,{onClick:S,children:n(o.length,`{n} table warning`,`{n} table warnings`,{n:o.length})})}),(0,J.jsx)(`h3`,{children:i(`Dice and log`)}),(0,J.jsx)(`ol`,{className:`workshop-log`,children:s.map(e=>(0,J.jsx)(`li`,{children:e.kind===`line`?e.text:``},e.key))})]}):(0,J.jsx)(`p`,{children:i(`Test table starts a game of your draft on this screen with each side's sample army. Every save reloads it there.`)})}function Ae({draft:e}){let[t,n]=(0,T.useState)([]),[r,a]=(0,T.useState)(!1),o=async()=>{a(!0),n([]),await H(e.source,[1,2,3],e=>n(t=>[...t,e])),a(!1)};return(0,J.jsxs)(`div`,{className:`workshop-soak`,children:[(0,J.jsx)(`p`,{children:i(`The soak bot plays whole games of your draft with random legal moves, over pretend peers, and checks every table stays the same and nothing throws.`)}),(0,J.jsx)(`button`,{onClick:()=>void o(),disabled:r||R(e.source).length>0,children:i(r?`Playing…`:`Play 3 bot games`)}),(0,J.jsx)(`ul`,{children:t.map(e=>(0,J.jsx)(`li`,{className:e.ok?`ok`:`bad`,children:e.ok?e.finished?i(`Game {seed}: fine, played to the end in {steps} moves.`,{seed:e.seed,steps:e.steps}):i(`Game {seed}: fine for {steps} moves, stopped in round {round}.`,{seed:e.seed,steps:e.steps,round:e.round}):i(`Game {seed} went wrong: {why}`,{seed:e.seed,why:e.failures[0]??``})},e.seed))})]})}function je({draft:e}){let[t,n]=(0,T.useState)(null),[r,a]=(0,T.useState)(``),[o,c]=(0,T.useState)(!1),l=L(e.source);return(0,T.useEffect)(()=>{let t=!0;return crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e.source)).then(e=>{t&&n(Array.from(new Uint8Array(e)).map(e=>e.toString(16).padStart(2,`0`)).join(``))}),()=>{t=!1}},[e.source]),typeof l==`string`?(0,J.jsx)(`p`,{children:l}):(0,J.jsxs)(`div`,{className:`workshop-export`,children:[(0,J.jsxs)(`p`,{children:[i(`{name} {version}`,{name:l.name,version:l.version}),t&&(0,J.jsxs)(J.Fragment,{children:[` · `,(0,J.jsx)(`code`,{title:t,children:s(t)})]})]}),(0,J.jsx)(`button`,{className:`primary`,onClick:()=>{f(new Blob([e.source],{type:`text/javascript`}),de(l))},children:i(`Download the package`)}),(0,J.jsx)(`p`,{className:`hint`,children:i(`Players load the file in Rules packages; peers check they have the same bytes by this fingerprint.`)}),(0,J.jsx)(`h3`,{children:i(`Share it in the gallery`)}),(0,J.jsx)(`p`,{className:`hint`,children:i(`To host it: make a gist at gist.github.com, paste the file in, save, and copy its Raw link. A file in a GitHub repository works too (its Raw button).`)}),(0,J.jsxs)(`label`,{children:[i(`Where the file is hosted (a raw link)`),(0,J.jsx)(`input`,{type:`url`,value:r,placeholder:Y,onChange:e=>a(e.target.value)})]}),(0,J.jsx)(`button`,{disabled:!t,onClick:()=>void navigator.clipboard.writeText(V(l,t,r)).then(()=>{c(!0),setTimeout(()=>c(!1),2e3)}),children:i(o?`Copied`:`Copy the pull request text`)}),` `,(0,J.jsx)(`a`,{href:fe,target:`_blank`,rel:`noreferrer`,children:i(`Edit the gallery on GitHub`)})]})}function Me(){let e=(e,t)=>(0,J.jsxs)(J.Fragment,{children:[(0,J.jsx)(`h3`,{children:e}),(0,J.jsx)(`dl`,{className:`workshop-ref`,children:t.map(e=>(0,J.jsxs)(`div`,{children:[(0,J.jsx)(`dt`,{children:(0,J.jsxs)(`code`,{children:[e.label,e.detail&&e.detail!==`snippet`?` ${e.detail}`:``]})}),(0,J.jsx)(`dd`,{children:typeof e.info==`string`?e.info:``})]},e.label))})]});return(0,J.jsxs)(`div`,{className:`workshop-sdk`,children:[(0,J.jsx)(`p`,{children:i(`Everything a package can use. In the editor, type ctx. or view. for suggestions.`)}),e(i(`Commands a rule yields (ctx.)`),O),e(i(`The game as it stands (view.)`),k),e(i(`Keys and snippets`),A),(0,J.jsx)(`p`,{children:(0,J.jsx)(`a`,{href:`${B.replace(`community-modules`,`packages`)}`,target:`_blank`,rel:`noreferrer`,children:i(`How packages work`)})}),(0,J.jsxs)(`details`,{children:[(0,J.jsx)(`summary`,{children:i(`The full types`)}),(0,J.jsx)(`pre`,{children:ie})]})]})}export{be as Workshop,te as n,F as t};