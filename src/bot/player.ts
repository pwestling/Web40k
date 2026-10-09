import { aliveModels } from "../core/units";
import {
  sidePlayers,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
  type Rng,
  type Unit,
} from "../core";
import { opposed } from "../core/teams";
import { fightPick } from "./fightPick";
import { actingUnits, actionTargets, unitActions } from "../core/content/play";
import { playerActions } from "../core/content/player";
import { currentSlot, plainActivations, schedule, systemOf } from "../core/content/turn";
import { gameView } from "../core/script";
import { seededRng } from "../sandbox/protocol";
import { gameModule } from "../systems";
import type { CodeAction } from "../sdk";
import {
  chargeMove,
  commandStack,
  freeMoves,
  legal,
  noteTaken,
  offTurnMoves,
  phaseKey,
  pointless,
  reaches,
  takenKey,
  waitingOn,
  wrongKind,
  type BotContext,
  type BotMove,
  type Kept,
} from "../soak/bot";
import { noteProgress, opponentMove } from "../teach/opponent";
import {
  evaluate,
  judge,
  rangeOf,
  SHARP,
  STEADY,
  type BotTuning,
  type Judge,
  type Weights,
} from "./evaluate";
import { missionOf, type Policy, type Seat } from "./policy";
import { Sim } from "./sim";

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

interface BotOptions {
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
}

/** The module's tuning for the bot, if it has any. */
function tuningOf(system: string | undefined): BotTuning | undefined {
  return gameModule(system)?.bot;
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
  const o: BotOptions = { seed: 1, tries: 3, beam: 0, plan: 0, planPasses: 3, planWidth: 4, ...opts };
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

/** Moves a policy may make in one activation, and in one phase with no unit acting, before it must move on. */
const ACTIVATION_CAP = 40;
const PHASE_CAP = 250;

/**
 * Whatever a policy thinks, a unit's go ends and the game moves on: past
 * the cap it ends the activation, passes, or goes to the next phase (UX 351).
 */
function guarded(p: Policy, seat: number): Policy {
  let mark = "";
  let n = 0;
  return {
    name: p.name,
    move(record, state, me) {
      const mine = new Set(sidePlayers(state, seat).map((x) => x.id));
      const acting = actingUnits(state).filter((u) => mine.has(u.owner));
      const m = `${state.turn.round}:${state.turn.activeSeat}:${state.turn.phase}:${acting.map((u) => u.id).join()}`;
      n = m === mark ? n + 1 : 0;
      mark = m;
      if (n >= (acting.length ? ACTIVATION_CAP : PHASE_CAP) && !state.script?.waiting) {
        const on: BotMove[] = [
          ...acting.map((u) => ({
            intent: { type: "turn/endActivation" } as Intent,
            as: u.owner,
            kind: "endActivation",
          })),
          { intent: { type: "turn/pass" } as Intent, as: me.player, kind: "pass" },
          { intent: { type: "turn/next" } as Intent, as: me.player, kind: "next" },
        ];
        const go = on.find((x) => legal(record, state, x));
        if (go) return go;
      }
      return p.move(record, state, me);
    },
    saw: (state, move) => p.saw?.(state, move),
  };
}

/** Before the battle: ready up (the armies are already in their zones). */
function setupMove(record: GameRecord, state: GameState, ctx: BotContext, me: Seat): BotMove | null {
  for (const m of freeMoves(state, { ...ctx, rng: () => 0.99 }))
    if (m.as === me.player && m.intent.type === "turn/next" && legal(record, state, m)) return m;
  return null;
}

interface Candidate {
  move: BotMove;
  /** What it uses up this phase (a unit's move, a weapon fired). */
  key?: string;
  /** Tries: 1 for a move with no dice. */
  tries: number;
  /** Must be played if it can be (a fight the unit is in). */
  must?: boolean;
  /** Activates the unit (alternating activations): judged by the best thing it could then do. */
  activates?: boolean;
  /** A faction stratagem on one of ours (#49): judged by that unit's best action after it, less its cost. */
  boost?: { unit: string; cp: number };
}

/** Sharp's time to plan each decision of a whole turn (#51), and the goes and steps it plays out. */
const PLAN_MS = 900;
const PLAN_TRIES = 6;
/** A pass running past the plan's time by more than this is dropped, keeping a decision under 2 s. */
const PLAN_GRACE_MS = 300;
const ROLLOUT_STEPS = 120;
const now = () => (globalThis.performance ?? Date).now();

/** What a command point is worth, as a share of a whole army's worth in VP. */
const CP_WORTH = 0.01;

const DBG = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BOT_DBG;
class Thinker implements Policy, Analyst {
  readonly name: string;
  private readonly sim: Sim;
  private readonly judge: Judge;
  private readonly tries: number;
  /** Sharp: how many of the best moves are judged with what could follow them. */
  private readonly beam: number;
  private done = { phase: "", keys: new Set<string>(), decisions: 0 };
  /** Sharp, in games where a side takes its whole turn (#51): ms per decision to play out the rest of the turn. */
  private readonly planMs: number;
  private readonly planWidth: number;
  /** The planner's last step: the enemy's whole turn (true) or only their guns. */
  private readonly replyTurn: boolean;
  private readonly planPasses: number;
  private readonly weigh: BotContext;

  constructor(
    level: Level,
    start: GameState,
    private readonly seat: number,
    private readonly ctx: BotContext & { mark?: string },
    private rng: Rng,
    opts: BotOptions,
  ) {
    this.name = level;
    this.sim = new Sim({ format: "open-battle/record@1", initial: start, events: [] });
    const sharp = level === "sharp";
    const tuning = tuningOf(start.system);
    this.judge = judge(
      start,
      seat,
      {
        ...(sharp ? SHARP : STEADY),
        ...(tuning?.threat !== undefined ? { threat: tuning.threat } : {}),
        ...opts.weights,
      },
      missionOf(start),
      tuning,
    );
    this.judge.reach = (state, u) => reachOf(state, u, tuning);
    this.judge.move = (state, u) => moveInches(state, u, tuning);
    this.tries = opts.tries ?? (sharp ? 4 : 2);
    this.beam = opts.beam ?? (sharp ? 4 : 0);
    this.planMs = opts.plan ?? (sharp ? PLAN_MS : 0);
    this.planWidth = opts.planWidth ?? 5;
    this.replyTurn = opts.replyTurn ?? tuning?.planReply !== "shots";
    this.planPasses = opts.planPasses ?? 3;
    this.weigh = { ...ctx, weighing: true };
  }

  get armyVp(): number {
    return this.judge.armyVp;
  }

  value(state: GameState): number {
    return evaluate(state, this.judge);
  }

  appraise(
    record: GameRecord,
    state: GameState,
    played: BotMove | null,
    used: ReadonlySet<string>,
    closer = false,
  ): Appraisal {
    this.sim.update(record, state);
    const tries = closer ? this.tries * 2 : this.tries;
    const passes = closer ? this.planPasses * 3 : this.planPasses;
    const own = this.rng;
    const mine = new Set(sidePlayers(state, this.seat).map((p) => p.id));
    const base = evaluate(this.sim.settle(state, own, new Map()), this.judge);
    const fights = fightPick(state, mine);
    const all = this.candidates(state, mine).filter(
      (c) =>
        (!c.key || !used.has(c.key)) &&
        (!fights || (c.move.intent.type === "action/take" && fights.units.includes(c.move.intent.unitId))) &&
        legal(record, state, c.move),
    );
    // Every option meets the same dice, so they differ by the choice, not by luck.
    const seed = Math.floor(own() * 2 ** 31);
    const worth = (c: Candidate, tries: number) => {
      this.rng = seededRng(seed);
      try {
        return c.activates
          ? this.activation(state, c, mine, base)
          : c.boost
            ? this.boosted(state, c, mine)
            : this.scoreOf(state, c, c.tries > 1 ? tries : 1);
      } finally {
        this.rng = own;
      }
    };
    // Taking a whole turn, every unit gets its go: a choice is weighed against what else that
    // unit (or that stratagem) could have done, not against another unit going first.
    const who = played ? unitOf(state, played) : undefined;
    if (who !== undefined && !plainActivations(state))
      all.splice(0, all.length, ...all.filter((c) => unitOf(state, c.move) === who));
    const same = played ? all.find((c) => sameMove(c.move, played)) : undefined;
    // The move as played (where it went, too), judged as its like would be; a code action whose
    // move the rules make later is judged as the bot would have played it.
    const key = played ? usedKey(state, played) : undefined;
    const like =
      played && !same && isMove(played) ? all.find((c) => c.key === key && isMove(c.move)) : undefined;
    const mine1: Candidate | undefined = !played
      ? undefined
      : same
        ? { ...same, move: same.move.then && !played.then ? same.move : played }
        : like
          ? { ...like, move: played }
          : { move: played, ...(key ? { key } : {}), tries: isMove(played) ? 1 : tries };
    // One go each, then the best few (and the one played) again with more dice.
    const quick = all.flatMap((c) => {
      const v = worth(c, 1);
      return v === null || c === same ? [] : [{ c, v }];
    });
    quick.sort((a, b) => b.v - a.v);
    for (const q of quick.slice(0, 5)) q.v = worth(q.c, tries) ?? q.v;
    const playedScore = mine1 ? worth(mine1, tries) : null;
    if (mine1 && playedScore !== null) quick.push({ c: mine1, v: playedScore });
    quick.sort((a, b) => b.v - a.v);
    // Moves in a side's whole turn pay off later in it: the best few, and the one played, each
    // with the rest of the turn and the enemy's answer played out, as Sharp plans.
    let deep = false;
    if (!plainActivations(state) && (played ? isMove(played) : quick.some((q) => isMove(q.c.move)))) {
      const options = [
        ...quick.slice(0, this.planWidth).filter((q) => q.c !== mine1),
        ...quick.filter((q) => q.c === mine1),
      ];
      const sums = options.map(() => ({ sum: 0, n: 0 }));
      const round = state.turn.round;
      for (let pass = 0; pass < passes; pass++) {
        const passSeed = seed + pass * 7919;
        options.forEach((o, i) => {
          this.rng = seededRng(passSeed);
          try {
            const s = this.play(state, o.c.move);
            const keys = new Set(used);
            if (o.c.key) keys.add(o.c.key);
            if (s) {
              sums[i]!.sum += this.rollout(s, mine, keys, round);
              sums[i]!.n++;
            }
          } finally {
            this.rng = own;
          }
        });
      }
      if (sums.every((x) => x.n)) {
        options.forEach((o, i) => (o.v = sums[i]!.sum / sums[i]!.n));
        quick.splice(0, quick.length, ...options.sort((a, b) => b.v - a.v));
        deep = true;
      }
    }
    const top = quick[0];
    const played1 = quick.find((q) => q.c === mine1);
    const target = (m: BotMove) => ("targetId" in m.intent ? m.intent.targetId : undefined) ?? "";
    const other = quick.find(
      (q) => q.c !== mine1 && (!mine1 || q.c.key !== mine1.key || target(q.c.move) !== target(mine1.move)),
    );
    return {
      best: top ? { move: top.c.move, score: top.v } : null,
      played: played1?.v ?? null,
      base,
      options: all.length,
      median: quick.length ? quick[Math.floor(quick.length / 2)]!.v : base,
      ...(other ? { second: other.v } : {}),
      ...(deep ? { deep } : {}),
      ...(mine1?.key ? { key: mine1.key } : {}),
    };
  }

  saw(state: GameState, move: BotMove): void {
    noteProgress(
      this.ctx,
      state,
      sidePlayers(state, this.seat).some((p) => p.id === move.as) ? move : undefined,
    );
  }

  move(record: GameRecord, state: GameState, me: Seat): BotMove | null {
    this.sim.update(record, state);
    if (state.turn.round === 0) return setupMove(record, state, this.ctx, me);
    const mine = new Set(sidePlayers(state, this.seat).map((p) => p.id));
    const waiting = waitingOn(record, state, this.weigh);
    if (waiting) {
      const options = dedupe(waiting.moves.filter((m) => mine.has(m.as) && legal(record, state, m)));
      // Not ours to answer (or nothing to choose between): the first that the rules take.
      if (
        options.length <= 1 ||
        options[0]!.kind === "roll" ||
        options[0]!.kind === "attack" ||
        options[0]!.kind === "reveal"
      )
        return options[0] ?? null;
      return this.best(
        state,
        options.slice(0, 12).map((move) => ({ move, tries: this.tries })),
        null,
      );
    }
    // Secret orders (Conquest's command stack) are locked in whoever's turn it is.
    for (const m of offTurnMoves(state, this.ctx, [...mine])) if (legal(record, state, m)) return m;
    // The Fight phase goes by the fight order: its pick, even in the player's turn, and never out of turn (PX #57).
    const fights = fightPick(state, mine);
    if (fights && !fights.ours) return null;
    if (state.turn.activeSeat !== this.seat && !fights) return null;
    const phase = phaseKey(state);
    if (this.done.phase !== phase) this.done = { phase, keys: new Set(), decisions: 0 };
    this.done.decisions++;
    // Drawing the next command card (Conquest): there's nothing to weigh.
    for (const m of commandStack(state, this.ctx, [...mine]))
      if (m.kind === "draw" && legal(record, state, m)) return m;
    const onward = this.onward(record, state, mine);
    if (this.done.decisions > 120) return onward;
    const candidates = this.candidates(state, mine).filter(
      (c) =>
        (!c.key || !this.done.keys.has(c.key)) &&
        (!fights || (c.move.intent.type === "action/take" && fights.units.includes(c.move.intent.unitId))),
    );
    const legalOnes = candidates.filter((c) => legal(record, state, c.move));
    const pick = this.best(state, legalOnes, onward, mine);
    if (!pick) return null;
    const chosen = legalOnes.find((c) => c.move === pick);
    if (chosen?.key) this.done.keys.add(chosen.key);
    noteTaken(this.ctx, state, pick);
    return pick;
  }

  /** Moving the game on: the end of an activation, then of the phase. */
  private onward(record: GameRecord, state: GameState, mine: Set<PlayerId>): BotMove | null {
    const moves: BotMove[] = [
      ...actingUnits(state)
        .filter((u) => mine.has(u.owner))
        .map((u) => ({
          intent: { type: "turn/endActivation" } as Intent,
          as: u.owner,
          kind: "endActivation",
        })),
      ...[...mine].map((p) => ({ intent: { type: "turn/next" } as Intent, as: p, kind: "next" })),
      ...[...mine].map((p) => ({ intent: { type: "turn/pass" } as Intent, as: p, kind: "pass" })),
    ];
    // Taking turns at activating units, ▶ would end the whole round: pass the go instead.
    if (plainActivations(state)) moves.sort((a, b) => Number(a.kind === "next") - Number(b.kind === "next"));
    return moves.find((m) => legal(record, state, m)) ?? null;
  }

  /** The candidate that leaves the table best; `fallback` when none beats standing pat. */
  private best(
    state: GameState,
    candidates: Candidate[],
    fallback: BotMove | null,
    mine?: Set<PlayerId>,
  ): BotMove | null {
    if (!candidates.length) return fallback;
    const must = candidates.filter((c) => c.must);
    const pool = must.length ? must : candidates;
    const base = evaluate(this.sim.settle(state, this.rng, new Map()), this.judge);
    let top: Candidate | null = null;
    let topScore = -Infinity;
    const scored: { c: Candidate; score: number }[] = [];
    for (const c of pool) {
      const score =
        c.activates && mine
          ? this.activation(state, c, mine, base)
          : c.boost && mine
            ? this.boosted(state, c, mine)
            : this.scoreOf(state, c, c.tries);
      if (score === null) continue;
      scored.push({ c, score });
      if (score > topScore) [top, topScore] = [c, score];
    }
    if (!top) return fallback;
    // Sharp, taking whole turns: the best few, each with the rest of the turn played out (#51).
    // Moves and charges pay off later in the turn; shots and fights are judged as they land.
    if (
      this.planMs &&
      mine &&
      !plainActivations(state) &&
      /move|charge/i.test(currentSlot(state)?.id ?? "")
    ) {
      const planned = this.planned(state, scored, must.length ? null : fallback, mine);
      if (planned !== undefined) return planned;
    }
    // Sharp, taking turns at activating units: the few best activations, each played out and
    // judged after the enemy's best answer with one of theirs.
    const acts = scored.filter(({ c }) => c.activates);
    if (DBG) console.log("acts", acts.length, scored.length, plainActivations(state), this.beam);
    if (this.beam && mine && acts.length > 1 && plainActivations(state)) {
      let pick: Candidate | null = null;
      let best = -Infinity;
      for (const { c } of acts.sort((a, b) => b.score - a.score).slice(0, this.beam)) {
        const v = this.replied(state, c, mine);
        if (v !== null && v > best) [pick, best] = [c, v];
      }
      if (pick) return pick.move;
    }
    // Sharp, moving: the few best moves (and staying put), each judged after the enemy's guns
    // answer it, so it doesn't walk into the open for a step nearer an objective.
    const moves = scored.filter(({ c }) => isMove(c.move) && !c.activates);
    if (this.beam && mine && moves.length > 1 && this.shootSlot(state) !== null) {
      const stay = fallback ? this.answered(this.sim.settle(state, this.rng, new Map()), mine) : -Infinity;
      let best = stay;
      let pick: Candidate | null = null;
      for (const { c } of moves.sort((a, b) => b.score - a.score).slice(0, this.beam)) {
        const s = this.play(state, c.move);
        if (!s) continue;
        const v = this.answered(s, mine);
        if (v > best + 0.01) [pick, best] = [c, v];
      }
      if (pick) return pick.move;
      if (fallback && !must.length && moves.some(({ c }) => c === top)) return fallback;
    }
    if (fallback && !must.length && topScore <= base + 0.01) return fallback;
    return top.move;
  }

  /**
   * The whole turn (#51): each of the few best moves now (and moving on),
   * played on with the rest of the turn, greedily and with the dice rolled,
   * then the enemy's guns answering; over as many goes as time allows, the
   * best on average. Undefined when there is nothing to choose between.
   */
  private planned(
    state: GameState,
    scored: { c: Candidate; score: number }[],
    fallback: BotMove | null,
    mine: Set<PlayerId>,
  ): BotMove | null | undefined {
    const deadline = now() + this.planMs;
    const options: { move: BotMove; c?: Candidate; sum: number; n: number }[] = [
      ...scored
        .filter(({ c }) => !c.boost)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.planWidth)
        .map(({ c }) => ({ move: c.move, c, sum: 0, n: 0 })),
      ...(fallback ? [{ move: fallback, sum: 0, n: 0 }] : []),
    ];
    if (options.length < 2) return undefined;
    const round = state.turn.round;
    const own = this.rng;
    for (let pass = 0; pass < PLAN_TRIES; pass++) {
      // Every option meets the same dice on a pass, so they differ by the move, not by luck;
      // a pass cut short by the hard limit counts for none of them.
      const seed = Math.floor(own() * 2 ** 31);
      const got: number[] = [];
      for (const o of options) {
        if (now() > deadline + PLAN_GRACE_MS) break;
        this.rng = seededRng(seed);
        const s = this.play(state, o.move);
        const keys = new Set(this.done.keys);
        if (o.c?.key) keys.add(o.c.key);
        got.push(s ? this.rollout(s, mine, keys, round) : NaN);
      }
      this.rng = own;
      if (got.length < options.length) break;
      got.forEach((v, i) => {
        if (Number.isNaN(v)) return;
        options[i]!.sum += v;
        options[i]!.n++;
      });
      if (now() > deadline) break;
    }
    let best: (typeof options)[number] | null = null;
    for (const o of options) if (o.n && (!best || o.sum / o.n > best.sum / best.n)) best = o;
    if (DBG)
      console.log(
        "plan",
        options.map((o) => `${o.move.kind}:${o.n}:${(o.sum / (o.n || 1)).toFixed(2)}`).join(" "),
      );
    return best?.move;
  }

  /**
   * The rest of this side's turn played on quickly, then the enemy's answer:
   * their whole turn, each step the worst for us, or only their guns.
   */
  private rollout(start: GameState, mine: Set<PlayerId>, keys: Set<string>, round: number): number {
    const s = this.played(start, this.seat, mine, 1, keys, round);
    const enemy = s.turn.activeSeat;
    if (!this.replyTurn || enemy === this.seat || s.turn.round > this.judge.rounds) return this.shotBack(s);
    const theirs = new Set(sidePlayers(s, enemy).map((p) => p.id));
    return evaluate(this.played(s, enemy, theirs, -1, new Set(), s.turn.round), this.judge);
  }

  /**
   * A side's turn played on quickly from here: unit by unit, each takes its
   * best next step (for us, sign 1; worst for us, -1) by one go with the dice
   * rolled, keeping that go, or stands down; then the next phase.
   */
  private played(
    start: GameState,
    seat: number,
    side: Set<PlayerId>,
    sign: 1 | -1,
    keys: Set<string>,
    round: number,
  ): GameState {
    let s = start;
    let phase = phaseKey(s);
    let resting = new Set<string>();
    for (let i = 0; i < ROLLOUT_STEPS; i++) {
      if (s.turn.activeSeat !== seat || s.turn.round !== round) break;
      if (phaseKey(s) !== phase) {
        phase = phaseKey(s);
        keys = new Set();
        resting = new Set();
      }
      // The next of this side's units still to act this phase, and only its options (the quick part).
      const units = Object.values(s.units).filter(
        (u) => side.has(u.owner) && !resting.has(u.id) && standing(s, u) && !u.status?.reserves,
      );
      let all: Candidate[] = [];
      let unit: string | undefined;
      for (const u of units) {
        all = this.candidates(s, side, u.id).filter((c) => !c.boost && c.key && !keys.has(c.key));
        if (all.length) {
          unit = u.id;
          break;
        }
        resting.add(u.id);
      }
      const musts = all.filter((c) => c.must);
      let next: GameState | null = null;
      if (unit) {
        const pool = musts.length ? musts : all;
        let top = musts.length ? -Infinity : sign * evaluate(s, this.judge) + 0.01;
        let pick: Candidate | null = null;
        for (const c of pool) {
          const t = this.play(s, c.move);
          if (!t) continue;
          const v = sign * evaluate(t, this.judge);
          if (v > top) [pick, next, top] = [c, t, v];
        }
        if (pick?.key) keys.add(pick.key);
        else resting.add(unit);
        if (!next) continue;
      } else {
        const p = [...side][0]!;
        next = this.play(s, { intent: { type: "turn/next" } as Intent, as: p, kind: "next" });
        if (!next) break;
      }
      s = next;
    }
    return s;
  }

  /** The enemy's attack phase in their turn (the first slot of a player's turn with targeted attacks), or null. */
  private shootSlot(state: GameState): number | null {
    const system = systemOf(state);
    const slots = schedule(system);
    const i = slots.findIndex(
      (slot) =>
        slot.playerTurn &&
        slot.actions.some((id) => {
          const def = system.actions.find((a) => a.id === id);
          return !!def?.procedure && !!def.target && !/fight|melee|charge/i.test(id);
        }),
    );
    return i < 0 ? null : i;
  }

  /**
   * The table judged after the enemy shoots back: each enemy unit makes the
   * attack that hurts most, picked from one try each (a quick, greedy reply).
   */
  private answered(s: GameState, mine: Set<PlayerId>): number {
    const slot = this.shootSlot(s);
    const enemy = Object.values(s.players).find((p) => p.seat !== undefined && p.seat !== this.seat)?.seat;
    if (slot === null || enemy === undefined) return evaluate(s, this.judge);
    let t: GameState = {
      ...s,
      procedure: null,
      attack: null,
      pending: null,
      turn: { ...s.turn, activeSeat: enemy, phase: slot },
    };
    const theirs = new Set(sidePlayers(t, enemy).map((p) => p.id));
    const byUnit = new Map<string, { c: Candidate; v: number }>();
    for (const c of this.candidates(t, theirs)) {
      const unit = c.move.intent.type === "action/take" ? c.move.intent.unitId : null;
      if (!unit || !("targetId" in c.move.intent) || !c.move.intent.targetId) continue;
      const v = this.scoreOf(t, c, 1);
      if (v === null) continue;
      const was = byUnit.get(`${unit}:${c.key}`);
      if (!was || v < was.v) byUnit.set(`${unit}:${c.key}`, { c, v });
    }
    // Their worst for us, each weapon once.
    for (const { c } of [...byUnit.values()].sort((a, b) => a.v - b.v)) t = this.play(t, c.move) ?? t;
    void mine;
    return evaluate(t, this.judge);
  }

  /**
   * The enemy's guns answering, quickly (the planner's last step): unit by
   * unit, each weapon at whatever hurts us most on one go of the dice,
   * keeping the go it took.
   */
  private shotBack(s: GameState): number {
    const slot = this.shootSlot(s);
    const enemy = Object.values(s.players).find((p) => p.seat !== undefined && p.seat !== this.seat)?.seat;
    if (slot === null || enemy === undefined) return evaluate(s, this.judge);
    let t: GameState = {
      ...s,
      procedure: null,
      attack: null,
      pending: null,
      turn: { ...s.turn, activeSeat: enemy, phase: slot },
    };
    const theirs = new Set(sidePlayers(t, enemy).map((p) => p.id));
    const used = new Set<string>();
    for (const u of Object.values(t.units)) {
      if (!theirs.has(u.owner) || !standing(t, u) || u.status?.reserves) continue;
      for (let shots = 0; shots < 8; shots++) {
        let worst: GameState | null = null;
        let low = Infinity;
        let key = "";
        for (const c of this.candidates(t, theirs, u.id)) {
          const i = c.move.intent;
          if (i.type !== "action/take" || !("targetId" in i) || !i.targetId || !c.key || used.has(c.key))
            continue;
          const after = this.play(t, c.move);
          if (!after) continue;
          const v = evaluate(after, this.judge);
          if (v < low) [worst, low, key] = [after, v, c.key];
        }
        if (!worst) break;
        used.add(key);
        t = worst;
      }
    }
    return evaluate(t, this.judge);
  }

  /**
   * An activation played out (its best follow-up, then the end of it), then
   * the enemy's activation that leaves us worst off: two plies, for taking
   * turns at activating units.
   */
  private replied(state: GameState, c: Candidate, mine: Set<PlayerId>): number | null {
    const s1 = this.play(state, c.move);
    if (!s1) return null;
    const s2 = this.ended(this.followed(s1, mine, 1), mine);
    const enemy = s2.turn.activeSeat;
    if (enemy === this.seat) return evaluate(s2, this.judge);
    const theirs = new Set(sidePlayers(s2, enemy).map((p) => p.id));
    let worst = evaluate(s2, this.judge);
    for (const e of this.candidates(s2, theirs)) {
      if (!e.activates) continue;
      const s3 = this.play(s2, e.move);
      if (!s3) continue;
      worst = Math.min(worst, evaluate(this.followed(s3, theirs, -1), this.judge));
    }
    return worst;
  }

  /** The table after a side's acting unit does its best (sign 1: best for us; -1: worst). */
  private followed(s: GameState, side: Set<PlayerId>, sign: 1 | -1): GameState {
    let best = s;
    let top = sign * evaluate(s, this.judge);
    for (const f of this.candidates(s, side)) {
      if (f.activates) continue;
      const t = this.play(s, f.move);
      if (!t) continue;
      const v = sign * evaluate(t, this.judge);
      if (v > top) [best, top] = [t, v];
    }
    return best;
  }

  /** Ending whatever activation the side still has going. */
  private ended(s: GameState, side: Set<PlayerId>): GameState {
    const u = actingUnits(s).find((x) => side.has(x.owner));
    if (!u) return s;
    return (
      this.play(s, {
        intent: { type: "turn/endActivation" } as Intent,
        as: u.owner,
        kind: "endActivation",
      }) ?? s
    );
  }

  /** A stratagem on one of ours: its unit's best action afterwards, less what the CP are worth. */
  private boosted(state: GameState, c: Candidate, mine: Set<PlayerId>): number | null {
    const s = this.play(state, c.move);
    if (!s || !c.boost) return null;
    let best: number | null = null;
    for (const f of this.candidates(s, mine)) {
      const i = f.move.intent;
      if (f.activates || i.type !== "action/take" || i.unitId !== c.boost.unit) continue;
      const v = this.scoreOf(s, f, f.tries);
      if (v !== null && (best === null || v > best)) best = v;
    }
    return best === null ? null : best - c.boost.cp * CP_WORTH * this.judge.armyVp;
  }

  /** The table after a candidate, judged: the average over `tries` goes (null if the host would refuse it). */
  private scoreOf(state: GameState, c: Candidate, tries: number): number | null {
    let total = 0;
    let n = 0;
    for (let i = 0; i < tries; i++) {
      const s = this.play(state, c.move);
      if (!s) break;
      total += evaluate(s, this.judge);
      n++;
    }
    return n ? total / n : null;
  }

  /** A move and what follows it on a copy of the table. */
  private play(state: GameState, move: BotMove): GameState | null {
    const local = new Map<number, GameState>();
    let s = this.sim.step(state, move.intent, move.as, this.rng, local);
    if (!s) return null;
    s = this.sim.settle(s, this.rng, local);
    if (move.then)
      s = this.sim.settle(
        this.sim.step(s, move.then.intent, move.then.as, this.rng, local) ?? s,
        this.rng,
        local,
      );
    return s;
  }

  /**
   * Activating a unit: worth the best single thing it could do next, and
   * always worth more than moving on (a unit left unactivated wastes its turn).
   */
  private activation(state: GameState, c: Candidate, mine: Set<PlayerId>, base: number): number | null {
    const s = this.play(state, c.move);
    if (!s) return null;
    let best = evaluate(s, this.judge);
    for (const f of this.candidates(s, mine)) {
      if (f.activates) continue;
      const v = this.scoreOf(s, f, 1);
      if (v !== null && v > best) best = v;
    }
    return Math.max(best, base + 0.02);
  }

  /** Everything the side's units could do now, as a player would. */
  private candidates(state: GameState, mine: Set<PlayerId>, only?: string): Candidate[] {
    const acting = actingUnits(state).filter((u) => mine.has(u.owner));
    const plain = plainActivations(state);
    const units = (acting.length ? acting : Object.values(state.units)).filter(
      (u) =>
        mine.has(u.owner) &&
        (!only || u.id === only) &&
        standing(state, u) &&
        !u.status?.reserves &&
        // Plain activations: each unit has one go a round.
        !(plain && !u.status?.acting && u.status?.activated),
    );
    const slot = currentSlot(state)?.id ?? "";
    const fighting = /combat|fight|melee/i.test(slot);
    const out: Candidate[] = [];
    for (const u of units) {
      let moveAction = false;
      for (const o of unitActions(state, u.id)) {
        if (o.def.reactTo) continue;
        if (pointless(state, u, o.def.id)) continue;
        if (o.def.procedure) {
          const weapons = Object.keys(u.sheet?.weapons ?? {});
          const targets = actionTargets(state, u.id, o.def.id).filter((t) => t.ok);
          for (const weapon of weapons.length ? weapons : [undefined])
            for (const t of targets) {
              if (weapon && (!reaches(state, u, weapon, t.unitId) || wrongKind(u, weapon, o.def.id)))
                continue;
              const req = { ...(weapon ? { weapon } : {}), targetId: t.unitId };
              if (!unitActions(state, u.id, req).find((x) => x.def.id === o.def.id)?.ok) continue;
              out.push({
                move: {
                  intent: { type: "action/take", unitId: u.id, action: o.def.id, ...req },
                  as: u.owner,
                  kind: `action:${o.def.id}`,
                },
                key: `${u.id}:${o.def.id}:${weapon ?? ""}`,
                tries: this.tries,
                must: fighting && /fight|melee|strike/i.test(o.def.id),
              });
            }
          continue;
        }
        if (!o.ok) continue;
        const withUnits = o.commands ? o.commands.candidates.slice(0, o.commands.count) : [];
        const take: BotMove = {
          intent: {
            type: "action/take",
            unitId: u.id,
            action: o.def.id,
            ...(withUnits.length ? { with: withUnits } : {}),
          },
          as: u.owner,
          kind: `action:${o.def.id}`,
        };
        const key = takenKey(state, u.id, o.def.id);
        if (o.def.move?.kind === "charge" || (o.move === undefined && /charge/i.test(o.def.id))) {
          const inches = o.move ?? 6 + 2 + Math.floor(this.rng() * 6);
          for (const e of enemiesWithin(state, u, 12))
            out.push({
              move: { ...take, then: chargeMove(state, u, this.ctx, Math.max(1, inches), e.id) },
              key,
              tries: this.tries,
            });
          continue;
        }
        if (o.move !== undefined) {
          moveAction = true;
          for (const then of destinations(state, u, Math.max(1, o.move)))
            out.push({ move: { ...take, then }, key, tries: 1 });
          continue;
        }
        out.push({
          move: take,
          key,
          tries: this.tries,
          ...(o.def.activates !== undefined ? { activates: true } : {}),
        });
      }
      // Moving by hand in a movement phase, where the unit has no move action; with plain
      // activations (a package game), moving is how a unit starts its go.
      if (
        !moveAction &&
        (/move/i.test(slot) || plain) &&
        !unitActions(state, u.id).some((o) => o.move !== undefined)
      )
        for (const m of [
          ...destinations(state, u, moveInches(state, u, tuningOf(state.system))),
          // Into contact, for a unit that fights hand to hand.
          ...(Object.values(u.sheet?.weapons ?? {}).some((w) => w.kind === "melee")
            ? enemiesWithin(state, u, moveInches(state, u, tuningOf(state.system))).map((e) =>
                chargeMove(state, u, this.ctx, moveInches(state, u, tuningOf(state.system)), e.id),
              )
            : []),
        ])
          out.push({
            move: m,
            key: `${u.id}:move`,
            tries: 1,
            ...(plain && !u.status?.acting ? { activates: true } : {}),
          });
    }
    out.push(...this.codeCandidates(state, units, fighting));
    if (only) return out;
    // Stratagems and other player actions, re-rolls aside (kept for a roll worth re-rolling).
    for (const p of mine)
      for (const o of playerActions(state, p)) {
        if (!o.ok || o.def.custom || /re.?roll/i.test(o.def.id)) continue;
        // A faction stratagem that does something it can weigh: only on a unit that can still act.
        const strat = state.armies?.[p]?.stratagems.find((s) => o.def.id === `army:${p}:${s.id}`);
        const army = o.def.id.startsWith("army:") && !!strat?.auto;
        if (o.def.id.startsWith("army:") && !army) continue;
        // One a turn or a battle (#53) is kept for a bigger moment: it costs more than its CP.
        const scarce = strat?.once === "battle" ? 3 : strat?.once === "turn" ? 1.5 : 1;
        const cp = scarce * o.payment.reduce((n, x) => n + (x.resource === "CP" ? (x.amount ?? 0) : 0), 0);
        for (const target of o.targets ?? [undefined])
          out.push({
            move: {
              intent: { type: "player/action", action: o.def.id, ...(target ? { targetId: target } : {}) },
              as: p,
              kind: `stratagem:${o.def.id}`,
            },
            key: `player:${o.def.id}`,
            tries: this.tries,
            ...(army && target ? { boost: { unit: target, cp } } : {}),
          });
      }
    // Dice placed on cards ahead of time (FSD): as the soak bot places them.
    for (const m of freeMoves(state, { ...this.ctx, rng: () => 0.1 })) {
      if (m.kind !== "place") break;
      if (mine.has(m.as)) out.push({ move: m, key: `place:${JSON.stringify(m.intent)}`, tries: 1 });
    }
    return out;
  }

  /** The module's (and packages') code actions, at each target. */
  private codeCandidates(state: GameState, units: Unit[], fighting: boolean): Candidate[] {
    if (state.script) return [];
    const mod = gameModule(state.system);
    const phase = currentSlot(state)?.id;
    const view = mod ? gameView(state, mod.system.id) : null;
    const out: Candidate[] = [];
    for (const u of units) {
      const actor = { player: u.owner, unitId: u.id };
      const rows = [
        ...(view
          ? (mod!.actions ?? [])
              .filter(
                (a: CodeAction) => a.by === "unit" && (!a.phases || (phase && a.phases.includes(phase))),
              )
              .filter((a) => !a.applies || a.applies(view, actor))
              .map((a) => {
                const available = a.available(view, actor);
                return {
                  id: a.id,
                  available,
                  targets: available === true && a.targets ? a.targets(view, actor) : [],
                  targeted: !!a.targets,
                };
              })
          : []),
        ...(this.ctx.packageActions?.(u.id, u.owner) ?? []).map((r) => ({
          ...r,
          targeted: r.targets.length > 0,
        })),
      ];
      for (const r of rows) {
        if (r.available !== true) continue;
        const targets = r.targeted
          ? r.targets.map((t) => t.unitId).filter((t): t is string => !!t)
          : [undefined];
        for (const target of targets) {
          const move: BotMove = {
            intent: {
              type: "script/start",
              procedure: r.id,
              args: { unit: u.id, ...(target ? { target } : {}) },
            },
            as: u.owner,
            kind: `code:${r.id}`,
          };
          const charge = /charge/i.test(r.id) && target;
          out.push({
            move: charge ? { ...move, then: chargeMove(state, u, this.ctx, 24, target) } : move,
            key: `${u.id}:code:${r.id}`,
            tries: this.tries,
            must: fighting && /fight|combat|strike|melee/i.test(r.id) && !/challenge/i.test(r.id),
          });
        }
      }
    }
    return out;
  }
}

/** The same choice: one unit's action (with its weapon and target), or the same placed moves. */
function sameMove(a: BotMove, b: BotMove): boolean {
  const x = a.intent;
  const y = b.intent;
  if (x.type !== y.type) return false;
  if (x.type === "action/take" && y.type === "action/take")
    return (
      x.unitId === y.unitId &&
      x.action === y.action &&
      (("weapon" in x && x.weapon) || "") === (("weapon" in y && y.weapon) || "") &&
      (("targetId" in x && x.targetId) || "") === (("targetId" in y && y.targetId) || "") &&
      !a.then === !b.then
    );
  return JSON.stringify(x) === JSON.stringify(y);
}

/** The unit a move is for, or the player action's id. */
function unitOf(state: GameState, m: BotMove): string | undefined {
  const i = m.intent;
  if (i.type === "action/take") return i.unitId;
  if (i.type === "models/move") return i.moves[0] ? state.models[i.moves[0].id]?.unitId : undefined;
  if (i.type === "script/start") return typeof i.args?.unit === "string" ? i.args.unit : undefined;
  if (i.type === "player/action") return `player:${i.action}`;
  return undefined;
}

/** What a move played uses up this phase, as the bot keys its own (a unit's move, a weapon fired). */
export function usedKey(state: GameState, m: BotMove): string | undefined {
  const i = m.intent;
  if (i.type === "action/take") {
    const def = systemOf(state).actions.find((a) => a.id === i.action);
    return def?.procedure
      ? `${i.unitId}:${i.action}:${("weapon" in i && i.weapon) || ""}`
      : takenKey(state, i.unitId, i.action);
  }
  if (i.type === "models/move") {
    const unit = i.moves[0] ? state.models[i.moves[0].id]?.unitId : undefined;
    return unit ? `${unit}:move` : undefined;
  }
  if (i.type === "script/start" && typeof i.args?.unit === "string")
    return `${i.args.unit}:code:${i.procedure}`;
  if (i.type === "player/action") return `player:${i.action}`;
  return undefined;
}

const isMove = (m: BotMove) => m.intent.type === "models/move" || m.then?.intent.type === "models/move";

const standing = (state: GameState, u: Unit) =>
  u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);

function dedupe(moves: BotMove[]): BotMove[] {
  const seen = new Set<string>();
  return moves.filter((m) => {
    const k = JSON.stringify(m.intent);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const centreOf = (state: GameState, u: Unit) => {
  const ms = aliveModels(state, u);
  return {
    x: ms.reduce((a, m) => a + m.position.x, 0) / Math.max(1, ms.length),
    y: ms.reduce((a, m) => a + m.position.y, 0) / Math.max(1, ms.length),
  };
};

function enemiesWithin(state: GameState, u: Unit, inches: number): Unit[] {
  const c = centreOf(state, u);
  return Object.values(state.units)
    .filter((e) => opposed(state, e.owner, u.owner) && aliveModels(state, e).length && !e.status?.reserves)
    .map((e) => ({ e, d: Math.hypot(centreOf(state, e).x - c.x, centreOf(state, e).y - c.y) }))
    .filter((x) => x.d <= inches + 6)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.e);
}

const num = (s: string | undefined) => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : undefined;
};

/** How far a unit moves by hand: the module's say, else its Move characteristic, else 6". */
function moveInches(state: GameState, u: Unit, tuning?: BotTuning): number {
  if (tuning?.moveInches) return tuning.moveInches(state, u);
  const m = aliveModels(state, u)[0];
  return num(m?.profile?.chars.M) ?? 6;
}

/** The furthest a unit can hurt from (its longest shot, else 1"), plus a move. */
function reachOf(state: GameState, u: Unit, tuning?: BotTuning): number {
  return Math.max(1, rangeOf(state, u)) + moveInches(state, u, tuning);
}

/**
 * Where a unit might move this turn: towards each objective (stopping on
 * it), towards the nearest enemy (stopping short), and back from it. The
 * unit moves as a block, staying on the table.
 */
function destinations(state: GameState, u: Unit, inches: number): BotMove[] {
  const ms = aliveModels(state, u);
  if (!ms.length) return [];
  const c = centreOf(state, u);
  const goals: { x: number; y: number; stop: number }[] = state.objectives.map((o) => ({
    ...o.position,
    stop: 0.5,
  }));
  const foes = Object.values(state.units)
    .filter((e) => opposed(state, e.owner, u.owner) && aliveModels(state, e).length && !e.status?.reserves)
    .map((e) => centreOf(state, e))
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  if (foes[0]) {
    goals.push({ ...foes[0], stop: 3 });
    // Back off, the same distance the other way.
    goals.push({ x: 2 * c.x - foes[0].x, y: 2 * c.y - foes[0].y, stop: 0 });
  }
  if (foes[1]) goals.push({ ...foes[1], stop: 3 });
  const hx = state.table.width / 2 - 1.5;
  const hy = state.table.depth / 2 - 1.5;
  const out: BotMove[] = [];
  for (const g of goals) {
    const dist = Math.hypot(g.x - c.x, g.y - c.y);
    const d = Math.max(0, Math.min(inches, dist - g.stop));
    if (d < 0.5) continue;
    let dx = ((g.x - c.x) / dist) * d;
    let dy = ((g.y - c.y) / dist) * d;
    // Keep every model on the table.
    for (const m of ms) {
      dx = Math.max(-hx - m.position.x, Math.min(hx - m.position.x, dx));
      dy = Math.max(-hy - m.position.y, Math.min(hy - m.position.y, dy));
    }
    out.push({
      intent: {
        type: "models/move",
        moves: ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } })),
      } as Intent,
      as: u.owner,
      kind: "move",
    });
  }
  return out;
}
