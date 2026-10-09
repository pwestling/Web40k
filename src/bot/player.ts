import { sidePlayers, type GameRecord, type GameState, type Rng } from "../core";
import { systemOf } from "../core/content/turn";
import { seededRng } from "../sandbox/protocol";
import type { BotContext, BotMove, Kept } from "../soak/bot";
import { noteProgress, opponentMove } from "../teach/opponent";
import type { Weights } from "./evaluate";
import type { Policy } from "./policy";
import { guarded, plainGame, setupMove, tuningOf } from "./moves";
import { Thinker } from "./thinker";

/**
 * A computer opponent (#45). "random" is the teaching opponent (the soak bot
 * playing tidily). "steady" and "sharp" look one move ahead: every move the
 * rules allow its units now (each attack at each target, each move towards
 * an objective or an enemy, each answer to a question) is tried on a copy of
 * the table with the host's own resolver, dice and all, a few times over,
 * and the one that leaves the table best by evaluate() is played. Sharp
 * tries each a few more times and weighs threats too. Each unit acts as a
 * player would: one move a phase, each weapon fired once, one go at each
 * action, and fights it is in are always fought.
 */

export type Level = "random" | "steady" | "sharp";

export interface BotOptions {
  seed: number;
  /** Package code actions for a unit (a package game). */
  packageActions?: BotContext["packageActions"];
  /** Secrets the bot committed (its "device"); shared with whatever answers its reveals. */
  kept?: Kept;
  /** Other weights than the level's (for tuning). */
  weights?: Partial<Weights>;
  /** Tries per move with dice, other than the level's. */
  tries?: number;
  /** How many of the best moves to judge with what could follow them, other than the level's. */
  beam?: number;
  /** Sharp, taking whole turns (#51): ms to plan each decision; 0 turns planning off. */
  plan?: number;
  /** How many of the best moves the planner plays out. */
  planWidth?: number;
  /** The planner's last step: the enemy's whole turn played greedily, not only their guns. */
  replyTurn?: boolean;
  /** Reviewing a game (#61): goes of the rest of the turn per move judged. */
  planPasses?: number;
  /** Passes of the dice for playing activations out, in games of activations with actions (0: off). */
  deepen?: number;
  /** Passes of the dice for each activation and the enemy's answer, in plain activations. */
  replyPasses?: number;
  /** Conquest's command stack: units nearest the enemy first or last (Sharp: last, so they answer the enemy's moves); shuffled if unset. */
  stackOrder?: "near" | "far";
  /**
   * "best": a try played as the game review needs it (#63), unset for play.
   * The game's questions (a charge reaction, a pursuit) are answered as the
   * side asked would, not at random (a random flee made charging the biggest
   * unit a lottery); a charge goes as far as its roll, not always home; a unit
   * that charged makes no other move; and a choice inside a try is made
   * without seeing its dice.
   */
  answers?: "best";
}

function contextFor(start: GameState, opts: BotOptions, rng: Rng): BotContext & { mark?: string } {
  return {
    rng,
    kept: opts.kept ?? new Map(),
    idle: 0,
    tidy: true,
    // A package game with no data actions: units head for the enemy and try their code actions.
    ...(systemOf(start).actions.length ? {} : { wholeGame: true }),
    ...(opts.packageActions ? { packageActions: opts.packageActions } : {}),
  };
}

export function botPolicy(level: Level, start: GameState, seat: number, opts: BotOptions): Policy {
  const rng = seededRng(opts.seed);
  const ctx = contextFor(start, opts, rng);
  return guarded(
    level === "random" ? randomPolicy(ctx, seat) : new Thinker(level, start, seat, ctx, rng, opts),
    seat,
  );
}

/** What a decision was worth against the others on offer, judged as Sharp judges a table (#61 Game review). */
export interface Appraisal {
  /** The best option found and its worth (on average, for one with dice). */
  best: { move: BotMove; score: number } | null;
  /** The move played, judged the same way; null when the rules wouldn't take it again. */
  played: number | null;
  /** The table as it stands, doing nothing. */
  base: number;
  /** How many options there were, and the middle one's worth. */
  options: number;
  median: number;
  /** The best option that isn't the one played (another unit, action or target), if any. */
  second?: number;
  /** Judged with the rest of the turn played out (moves and charges, as Sharp plans them). */
  deep?: boolean;
  /** What the played move used up this phase (a unit's move, a weapon fired). */
  key?: string;
}

/** Sharp's eye on a game already played, for one side (#61): what each decision was worth, and the table's. */
export interface Analyst {
  appraise(
    record: GameRecord,
    state: GameState,
    played: BotMove | null,
    used: ReadonlySet<string>,
    /** A closer look (a turning point being checked): more dice and more goes of the turn. */
    closer?: boolean,
  ): Appraisal;
  /** How the table stands for this side (higher is better). */
  value(state: GameState): number;
  /** What a whole army is worth on that scale. */
  readonly armyVp: number;
}

export function analyst(start: GameState, seat: number, opts: Partial<BotOptions> = {}): Analyst {
  const o: BotOptions = {
    seed: 1,
    // Six goes of each shot or blow: three left a long shot that came off once (or missed every
    // time) ranked above a sure thing (#63).
    tries: 6,
    beam: 0,
    plan: 0,
    planPasses: tuningOf(start.system)?.reviewPasses ?? 3,
    planWidth: 4,
    answers: "best",
    replyTurn: true,
    ...opts,
  };
  // A wounded unit fights on whole until its last model falls: the review counts more of its worth
  // as going only then (#63: a 2-wound monster read as worth less than a fresh character).
  if (!plainGame(start)) o.weights = { finish: 0.5, ...o.weights };
  const rng = seededRng(o.seed);
  const thinker = new Thinker("sharp", start, seat, contextFor(start, o, rng), rng, o);
  return thinker;
}

/** The teaching opponent: the tidy soak bot. */
function randomPolicy(ctx: BotContext & { mark?: string }, seat: number): Policy {
  return {
    name: "random",
    move: (record, state, me) =>
      state.turn.round === 0 ? setupMove(record, state, ctx, me) : opponentMove(record, state, ctx, me.seat),
    saw: (state, move) =>
      noteProgress(ctx, state, sidePlayers(state, seat).some((p) => p.id === move.as) ? move : undefined),
  };
}
