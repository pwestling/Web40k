import { aliveModels, isAlive } from "../core/units";
import { closeDoor, unitGap } from "../core/manoeuvre";
import { inchesPerUnit } from "../core/content/runtime";
import {
  sidePlayers,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
  type ArmyStratagem,
  type Rng,
  type Unit,
} from "../core";
import { actingUnits, placeablePool, unitActions } from "../core/content/play";
import { armyStratagem, playerActions } from "../core/content/player";
import { fightOrder } from "../systems/wh40k/fight";
import { fightPick } from "./fightPick";
import { currentSlot, plainActivations, schedule, systemOf } from "../core/content/turn";
import { gameView, pointsShort } from "../core/script";
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
  perches,
  phaseKey,
  pointless,
  reaches,
  takenKey,
  waitingOn,
  wrongKind,
  type BotContext,
  type BotMove,
} from "../soak/bot";
import { noteProgress } from "../teach/opponent";
import { evaluate, judge, SHARP, STEADY, type Judge } from "./evaluate";
import { missionOf, type Policy, type Seat } from "./policy";
import { Sim } from "./sim";
import type { Analyst, Appraisal, BotOptions, Level } from "./player";
import type { Candidate } from "./moves";
import {
  actionActivations,
  aims,
  chargeReach,
  dedupe,
  destinations,
  enemiesWithin,
  handCharge,
  hasKeyword,
  inOrder,
  isMove,
  landing,
  marchOf,
  moveInches,
  plainGame,
  reachOf,
  sameMove,
  setupMove,
  shields,
  standing,
  targetsOf,
  tuningOf,
  unhurt,
  unitOf,
  usedKey,
  weaponTargets,
  wounded,
} from "./moves";

/**
 * The Thinker (#45): Steady and Sharp, and the analyst the game review asks
 * (split from player.ts, #70). Each move the rules allow is tried on a copy
 * of the table and the best by evaluate() is played; see player.ts.
 */

/** Sharp's time to plan each decision of a whole turn (#51), and the goes and steps it plays out. */
const PLAN_MS = 900;
const PLAN_TRIES = 6;
/** A pass running past the plan's time by more than this is dropped, keeping a decision under 2 s. */
const PLAN_GRACE_MS = 300;
const ROLLOUT_STEPS = 120;
const now = () => (globalThis.performance ?? Date).now();

/** What a command point is worth, as a share of a whole army's worth in VP. */
const CP_WORTH = 0.01;
/** Times it lets the other player make their pick in the fight order before fighting on. */
const FIGHT_WAITS = 3;

const DBG = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BOT_DBG;
export class Thinker implements Policy, Analyst {
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
  /** Sharp, in games of activations with actions: passes of the dice for playing activations out (0: off). */
  private readonly deepen: number;
  /** Sharp, in plain activations: passes of the dice for each activation and the enemy's answer. */
  private readonly replyPasses: number;
  private readonly stackOrder?: "near" | "far";
  private readonly answers?: "best";
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
        // Taking turns at moving units, Sharp's dice-averaged look at the enemy's answer already
        // weighs finishing units off; the bonus for it on top played worse (#58).
        ...(sharp && plainGame(start) ? { finish: 0 } : {}),
        ...(tuning?.threat !== undefined ? { threat: tuning.threat } : {}),
        ...(sharp ? tuning?.sharp : {}),
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
    this.deepen = opts.deepen ?? (sharp ? 2 : 0);
    this.replyPasses = opts.replyPasses ?? 3;
    this.stackOrder = opts.stackOrder ?? (sharp ? "far" : undefined);
    if (opts.answers) this.answers = opts.answers;
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
    // Every option meets the same dice, so they differ by the choice, not by luck. Each look takes
    // fresh dice (seeds a, b, c): the option that looked best on one look is judged again on the
    // next, so one lucky go doesn't make it the best on offer (#63: a long shot at a lone character
    // that came off once read as the play to make).
    const seed = Math.floor(own() * 2 ** 31);
    const looks = [seed, seed + 104729, seed + 2 * 104729] as const;
    const worth = (c: Candidate, tries: number, at: number = looks[0]) => {
      this.rng = seededRng(at);
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
    // A charge rolled by hand is logged as its declaration, the roll after it: it's the bot's own
    // rolled charge at that target, judged by the odds (#66: judged as never rolled, it read as costly).
    const same = played
      ? all.find(
          (c) =>
            sameMove(c.move, played) ||
            (!!c.charge && !played.then && sameMove(c.move, { ...played, then: c.move.then })),
        )
      : undefined;
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
    for (const q of quick.slice(0, 5)) q.v = worth(q.c, tries, looks[1]) ?? q.v;
    const playedScore = mine1 ? worth(mine1, tries, looks[1]) : null;
    if (mine1 && playedScore !== null) quick.push({ c: mine1, v: playedScore });
    quick.sort((a, b) => b.v - a.v);
    // Moves in a side's whole turn pay off later in it: the best few, and the one played, each
    // with the rest of the turn and the enemy's answer played out, as Sharp plans. Once one of the
    // best few is a move, they all are judged so (staying put against moving, a shot against a
    // move), never a played-out move against an option judged where it stands.
    const acts = actionActivations(state);
    const deepOf = (options: { c: Candidate }[], at: number): (number | null)[] => {
      const sums = options.map(() => ({ sum: 0, n: 0 }));
      const round = state.turn.round;
      for (let pass = 0; pass < passes; pass++) {
        const passSeed = at + pass * 7919;
        options.forEach((o, i) => {
          this.rng = seededRng(passSeed);
          try {
            const s = this.play(state, o.c.move);
            const keys = new Set(used);
            if (o.c.key) keys.add(o.c.key);
            if (s) {
              // Taking turns at activations (FSD, Conquest): the rest of the activation, then the
              // enemy's that hurts most, as Sharp plans one; else the rest of the turn.
              sums[i]!.sum += acts
                ? this.answeredActivation(this.finished(s, mine, 1), mine)
                : this.rollout(s, mine, keys, round);
              sums[i]!.n++;
            }
          } finally {
            this.rng = own;
          }
        });
      }
      return sums.map((x) => (x.n ? x.sum / x.n : null));
    };
    let deep = false;
    const moves = played
      ? isMove(played) || quick.slice(0, this.planWidth).some((q) => isMove(q.c.move))
      : quick.some((q) => isMove(q.c.move));
    if (!plainActivations(state) && moves) {
      const options = [
        ...quick.slice(0, this.planWidth).filter((q) => q.c !== mine1),
        ...quick.filter((q) => q.c === mine1),
      ];
      const got = deepOf(options, looks[1]);
      if (got.every((v) => v !== null)) {
        options.forEach((o, i) => (o.v = got[i]!));
        quick.splice(0, quick.length, ...options.sort((a, b) => b.v - a.v));
        deep = true;
      }
    }
    // The last look: the best found, the one played and the best other choice judged again on fresh
    // dice, so the one that rolled best on the dice that picked it isn't taken at its word.
    const confirm = quick.filter(
      (q, i) => i === 0 || q.c === mine1 || q === quick.find((x) => x.c !== mine1 && x !== quick[0]),
    );
    if (confirm.length > 1) {
      const again = deep
        ? deepOf(confirm, looks[2])
        : confirm.map((q) => worth(q.c, q.c.tries > 1 ? tries : 1, looks[2]));
      if (again.every((v) => v !== null)) {
        confirm.forEach((q, i) => (q.v = again[i]!));
        quick.sort((a, b) => b.v - a.v);
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
      // An enemy attack on one of ours: a stratagem that protects it, if it's worth its CP.
      const guard = this.guard(record, state, mine);
      if (guard) return guard;
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
    for (const m of offTurnMoves(state, this.ctx, [...mine]))
      if (legal(record, state, m)) return this.stacked(state, m);
    const phase = phaseKey(state);
    if (this.done.phase !== phase) this.done = { phase, keys: new Set(), decisions: 0 };
    // The 40k Fight phase in the enemy's turn: our picks in the fight order are ours to make.
    if (state.turn.activeSeat !== this.seat) return this.theirFight(record, state, mine);
    this.done.decisions++;
    // Drawing the next command card (Conquest): there's nothing to weigh.
    for (const m of commandStack(state, this.ctx, [...mine]))
      if (m.kind === "draw" && legal(record, state, m)) return m;
    const onward = this.onward(record, state, mine);
    if (this.done.decisions > 120) return onward;
    let candidates = this.candidates(state, mine).filter((c) => !c.key || !this.done.keys.has(c.key));
    // Fights in the 40k fight order: Fights First first, then turn about, the other player first.
    const order = fightOrder(state);
    if (order) {
      const fights = inOrder(state, order, candidates, mine);
      if (fights === "wait" && this.yielded(state)) return null;
      if (fights !== "wait") candidates = fights;
    }
    const legalOnes = candidates.filter((c) => legal(record, state, c.move));
    const pick = this.best(state, legalOnes, onward, mine);
    if (!pick) return null;
    const chosen = legalOnes.find((c) => c.move === pick);
    if (chosen?.key) this.done.keys.add(chosen.key);
    noteTaken(this.ctx, state, pick);
    return pick;
  }

  /** Calls in a row, at one table, that it let the other player pick a fight first. */
  private waited = { seq: -1, n: 0 };

  /**
   * Whether to let the other player make their pick in the fight order: a
   * few times at one table, then it fights on (the order is advice, and an
   * opponent who doesn't pick mustn't stall the game).
   */
  private yielded(state: GameState): boolean {
    this.waited =
      state.seq === this.waited.seq ? { seq: state.seq, n: this.waited.n + 1 } : { seq: state.seq, n: 1 };
    return this.waited.n <= FIGHT_WAITS;
  }

  /** In the enemy's turn: our picks in the 40k fight order (each fight it is in is fought). */
  private theirFight(record: GameRecord, state: GameState, mine: Set<PlayerId>): BotMove | null {
    const order = fightOrder(state);
    if (!order) return null;
    const fights = inOrder(state, order, this.candidates(state, mine), mine);
    if (fights === "wait") return null;
    const options = fights.filter(
      (c) => c.must && (!c.key || !this.done.keys.has(c.key)) && legal(record, state, c.move),
    );
    if (!options.length) return null;
    const pick = this.best(state, options, null);
    const chosen = options.find((c) => c.move === pick);
    if (chosen?.key) this.done.keys.add(chosen.key);
    return pick;
  }

  /**
   * A stratagem for one of ours under attack (taught with #53 or read from
   * the roster): one whose rule works on attacks against it (a better save,
   * an invulnerable save, Feel No Pain, harder to hit or wound), used before
   * the dice fall when the attack's expected harm, with it and without it on
   * the same dice, differs by more than its CP are worth. Asked once an attack.
   */
  private guard(record: GameRecord, state: GameState, mine: Set<PlayerId>): BotMove | null {
    const proc = state.procedure;
    const target = proc?.targetId ? state.units[proc.targetId] : undefined;
    if (!proc || proc.run.done || !target || !mine.has(target.owner)) return null;
    const mark = `${state.turn.round}:${state.turn.phase}:${proc.unitId}:${proc.action}:${proc.weapon ?? ""}:${target.id}`;
    if (this.guarded.has(mark)) return null;
    this.guarded.add(mark);
    const options: { move: BotMove; cost: number }[] = [];
    for (const p of mine)
      for (const o of playerActions(state, p)) {
        const strat = armyStratagem(state, o.def.id);
        if (!o.ok || !strat?.auto || !o.targets?.includes(target.id) || !shields(strat.auto.parts)) continue;
        const move: BotMove = {
          intent: { type: "player/action", action: o.def.id, targetId: target.id },
          as: p,
          kind: `stratagem:${o.def.id}`,
        };
        if (legal(record, state, move)) options.push({ move, cost: this.cpCost(strat, o.payment) });
      }
    if (!options.length) return null;
    // Each option and doing nothing meet the same dice.
    const seeds = Array.from({ length: this.tries * 2 }, () => Math.floor(this.rng() * 2 ** 31));
    const after = (s: GameState | null) => {
      if (!s) return -Infinity;
      let v = 0;
      for (const seed of seeds) v += evaluate(this.sim.settle(s, seededRng(seed), new Map()), this.judge);
      return v / seeds.length;
    };
    let best: BotMove | null = null;
    let top = after(state);
    for (const o of options) {
      const used = this.sim.step(state, o.move.intent, o.move.as, this.rng, new Map());
      const v = after(used) - o.cost;
      if (v > top) [best, top] = [o.move, v];
    }
    return best;
  }

  /** Attacks it guarded against already (or chose not to). */
  private readonly guarded = new Set<string>();

  /** What a stratagem's CP are worth to the judge; one a turn or a battle is kept for a bigger moment. */
  private cpCost(strat: ArmyStratagem | undefined, payment: { resource: string; amount?: number }[]): number {
    const scarce = strat?.once === "battle" ? 3 : strat?.once === "turn" ? 1.5 : 1;
    const cp = payment.reduce((n, x) => n + (x.resource === "CP" ? (x.amount ?? 0) : 0), 0);
    return scarce * cp * CP_WORTH * this.judge.armyVp;
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
    // Sharp, taking turns at activating units: the few best ways to start a unit's go (moving, or
    // acting where it stands), each played out and judged after the enemy's best answer with one
    // of theirs, over a few passes that give every option the same dice.
    const between = plainActivations(state) && !actingUnits(state).length;
    const acts = scored.filter(({ c }) => c.activates || (between && !c.boost));
    if (this.beam && mine && acts.length > 1 && plainActivations(state)) {
      const top = acts.sort((a, b) => b.score - a.score).slice(0, this.beam);
      const sums = top.map(() => 0);
      const own = this.rng;
      for (let pass = 0; pass < this.replyPasses; pass++) {
        const seed = Math.floor(own() * 2 ** 31);
        top.forEach(({ c }, i) => {
          this.rng = seededRng(seed);
          sums[i] = sums[i]! + (this.replied(state, c, mine) ?? -Infinity);
        });
      }
      this.rng = own;
      let pick = top[0]!.c;
      let best = -Infinity;
      top.forEach(({ c }, i) => {
        if (sums[i]! > best) [pick, best] = [c, sums[i]!];
      });
      return pick.move;
    }
    // Sharp, in a game of activations with actions (Conquest, FSD): the few best, each with the
    // rest of the unit's activation played out and the enemy's next activation answering it.
    if (this.beam && mine && this.deepen && actionActivations(state)) {
      const picked = this.activationPlan(state, scored, must.length ? null : fallback, mine);
      if (picked !== undefined) return picked;
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
   * In a game of activations with actions: the few best options now (and
   * moving on), each played on to the end of the unit's activation, then
   * the enemy's activation that leaves us worst off; every option meets the
   * same dice on a pass. Undefined when there is nothing to choose between.
   */
  private activationPlan(
    state: GameState,
    scored: { c: Candidate; score: number }[],
    fallback: BotMove | null,
    mine: Set<PlayerId>,
  ): BotMove | null | undefined {
    // Moving on first (it's quick), then the best first, so time running out drops the least likely.
    let options: { move: BotMove; sum: number }[] = [
      ...(fallback ? [{ move: fallback, sum: 0 }] : []),
      ...scored
        .filter(({ c }) => !c.boost)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.beam)
        .map(({ c }) => ({ move: c.move, sum: 0 })),
    ];
    if (options.length < 2) return undefined;
    const own = this.rng;
    // While the plan's time lasts: the first pass keeps the options it got to; a later pass cut short counts for none.
    const deadline = now() + PLAN_MS;
    for (let pass = 0; pass < this.deepen; pass++) {
      if (pass && now() > deadline) break;
      const seed = Math.floor(own() * 2 ** 31);
      const got: number[] = [];
      for (const o of options) {
        if (got.length > 1 && now() > deadline + PLAN_GRACE_MS) break;
        this.rng = seededRng(seed);
        const s = this.play(state, o.move);
        got.push(s ? this.answeredActivation(this.finished(s, mine, 1), mine) : -Infinity);
      }
      if (pass && got.length < options.length) break;
      options = options.slice(0, got.length);
      got.forEach((v, i) => (options[i]!.sum += v));
    }
    this.rng = own;
    // Moving on only when it's strictly better.
    let best = options[fallback ? 1 : 0]!;
    for (const o of options) if (o.sum > best.sum) best = o;
    return best.move;
  }

  /** The command stack in the order asked for: the same cards, sorted by how near each unit is to the enemy. */
  private stacked(state: GameState, m: BotMove): BotMove {
    const i = m.intent as { secrets?: { key: string; commitment: string }[] };
    if (!this.stackOrder || !i.secrets) return m;
    const gap = (id: string): number => {
      const u = state.units[id];
      let best = Infinity;
      if (u)
        for (const e of Object.values(state.units))
          if (e.owner !== u.owner && isAlive(state, e)) best = Math.min(best, unitGap(state, u, e));
      return best;
    };
    const cards = i.secrets.map((c) => ({ c, gap: gap(String(this.ctx.kept.get(c.commitment)?.value)) }));
    const sign = this.stackOrder === "far" ? -1 : 1;
    const sorted = [...cards].sort((a, b) => sign * (a.gap - b.gap));
    return {
      ...m,
      intent: {
        ...m.intent,
        secrets: i.secrets.map((c, n) => ({ key: c.key, commitment: sorted[n]!.c.commitment })),
      },
    } as BotMove;
  }

  /** A side's acting unit's activation played to its end: its best next action while one helps, then ending it. */
  private finished(s: GameState, side: Set<PlayerId>, sign: 1 | -1): GameState {
    for (let i = 0; i < 4 && actingUnits(s).some((u) => side.has(u.owner)); i++) {
      const next = this.followed(s, side, sign);
      if (next === s) break;
      s = next;
    }
    return this.ended(s, side);
  }

  /** The table judged after the enemy's activation that leaves us worst off, if it's theirs to activate now. */
  private answeredActivation(s: GameState, mine: Set<PlayerId>): number {
    const worst = evaluate(s, this.judge);
    const enemy = s.turn.activeSeat;
    if (enemy === this.seat) return worst;
    const theirs = new Set(sidePlayers(s, enemy).map((p) => p.id));
    if ([...theirs].some((p) => mine.has(p))) return worst;
    // Reviewing (#63), the one that looks worst on dice of its own (by its first action, a charge
    // with its move into contact), played to its end on the try's; playing, its first action.
    const answer = (e: Candidate, whole: boolean) => {
      const t = this.play(s, e.move);
      return t && (whole ? this.finished(t, theirs, -1) : this.followed(t, theirs, -1));
    };
    const choose = () => {
      let pick: Candidate | null = null;
      let low = worst;
      for (const e of this.candidates(s, theirs)) {
        if (!e.activates) continue;
        const t = answer(e, false);
        const v = t ? evaluate(t, this.judge) : Infinity;
        if (v < low) [pick, low] = [e, v];
      }
      return { pick, low };
    };
    if (!this.answers) return choose().low;
    const { pick } = this.unseen(choose);
    const t = pick && answer(pick, true);
    return t ? evaluate(t, this.judge) : worst;
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
    // Their go: moving, or (between activations) acting where they stand.
    const between = !actingUnits(s2).length;
    for (const e of this.candidates(s2, theirs)) {
      if (!e.activates && !(between && !e.boost)) continue;
      const s3 = this.play(s2, e.move);
      if (!s3) continue;
      worst = Math.min(worst, evaluate(this.followed(s3, theirs, -1), this.judge));
    }
    return worst;
  }

  /** The table after a side's acting unit does its best (sign 1: best for us; -1: worst). */
  private followed(s: GameState, side: Set<PlayerId>, sign: 1 | -1): GameState {
    const all = this.candidates(s, side).filter((f) => !f.activates);
    // Reviewing, what must be played comes first (a charge that reached makes its move into contact).
    const musts = this.answers ? all.filter((f) => f.must) : [];
    const step = (f: Candidate) => {
      const t = this.play(s, f.move);
      // A charge rolled by hand pays off after it: its move into contact, then what that leads to.
      return t && f.charge && this.answers ? this.followed(this.followed(t, side, sign), side, sign) : t;
    };
    const choose = () => {
      let pick: Candidate | null = null;
      let best = s;
      let top = musts.length ? -Infinity : sign * evaluate(s, this.judge);
      for (const f of musts.length ? musts : all) {
        const t = step(f);
        if (!t) continue;
        const v = sign * evaluate(t, this.judge);
        if (v > top) [pick, best, top] = [f, t, v];
      }
      return { pick, best };
    };
    if (!this.answers) return choose().best;
    const { pick } = this.unseen(choose);
    return pick ? (step(pick) ?? s) : s;
  }

  /**
   * Reviewing (#63): a choice inside a try made on dice of its own, then played
   * on the try's dice, so a try doesn't keep whichever choice happened to roll
   * well (a unit's luckiest shot read as its follow-up made any move that left
   * it a shot look strong, and the enemy's luckiest answer any move look poor).
   */
  private unseen<T>(choose: () => T): T {
    const real = this.rng;
    this.rng = seededRng(Math.floor(real() * 2 ** 31));
    try {
      return choose();
    } finally {
      this.rng = real;
    }
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
    if (c.charge) return this.charged(state, c);
    let total = 0;
    let n = 0;
    let risk: number | null = null;
    for (let i = 0; i < tries; i++) {
      let s = this.play(state, c.move);
      if (!s) break;
      // Hazardous: the bearers' own roll comes out of the picture, and its expected harm goes in.
      if (c.hazard) {
        s = unhurt(s, state, c.hazard.unit);
        risk ??= this.hazardRisk(s, c.hazard.unit, c.hazard.weapon);
        total -= risk;
      }
      total += evaluate(s, this.judge);
      n++;
    }
    return n ? total / n : null;
  }

  /**
   * What a Hazardous weapon's roll is expected to cost the unit that used it
   * (the 40k rule: on a 1 or 2 of a D6 a bearer takes a mortal wound, three
   * for a Character or Monster), in the judge's terms.
   */
  private hazardRisk(s: GameState, unitId: string, weapon: string): number {
    const u = s.units[unitId];
    if (!u) return 0;
    const kw = (u.sheet?.keywords ?? []).map((k) => k.toUpperCase());
    const wounds = kw.includes("CHARACTER") || kw.includes("MONSTER") ? 3 : 1;
    const bearer =
      aliveModels(s, u).find((m) => !m.weapons || m.weapons.includes(weapon)) ?? aliveModels(s, u)[0];
    if (!bearer) return 0;
    const hurt = wounded(s, bearer.id, wounds);
    return (2 / 6) * (evaluate(s, this.judge) - evaluate(hurt, this.judge));
  }

  /**
   * A charge rolled by hand (Conquest): declared, then judged both ways, as
   * it lands (rolled high enough, lined up against the target, Inspired) and
   * as it falls short (the activation over), each by its odds on the die.
   */
  private charged(state: GameState, c: Candidate): number | null {
    const local = new Map<number, GameState>();
    const take = this.sim.step(state, c.move.intent, c.move.as, this.rng, local);
    const roll = c.move.then?.intent;
    if (!take || !c.charge || roll?.type !== "dice/roll") return null;
    const s1 = this.sim.settle(take, this.rng, local);
    const u = s1.units[c.charge.unit];
    const e = s1.units[c.charge.target];
    const door = u && e ? closeDoor(s1, u, e) : null;
    const sides = roll.sides;
    if (!u || !door || roll.count !== 1) return evaluate(s1, this.judge);
    // The lowest face that reaches.
    const need = Math.max(1, Math.ceil(unitGap(s1, u, e!) - marchOf(s1, u) - 0.05));
    const p = Math.max(0, Math.min(1, (sides - need + 1) / sides));
    const rolled = (face: number) => {
      const r = this.sim.step(s1, roll, c.move.as, () => (face - 0.5) / sides, new Map(local));
      return r ? this.sim.settle(r, this.rng, local) : null;
    };
    let score = 0;
    if (p > 0) {
      const hit = rolled(sides);
      const unit = hit?.units[u.id];
      const move = hit && unit ? landing(hit, unit, !!this.answers) : null;
      const landed = hit && move ? this.play(hit, move) : hit;
      if (!landed) return null;
      // What landing is for: the fight it starts (Impact, a Clash) with the actions left.
      const side = new Set(sidePlayers(landed, this.seat).map((x) => x.id));
      score += p * evaluate(this.followed(landed, side, 1), this.judge);
    }
    if (p < 1) {
      const miss = rolled(Math.min(need - 1, sides));
      if (!miss) return null;
      score += (1 - p) * evaluate(miss, this.judge);
    }
    return score;
  }

  /** A move and what follows it on a copy of the table. */
  private play(state: GameState, move: BotMove): GameState | null {
    const local = new Map<number, GameState>();
    const answer = this.answers ? this.answerer(local) : undefined;
    let s = this.sim.step(state, move.intent, move.as, this.rng, local);
    if (!s) return null;
    s = this.sim.settle(s, this.rng, local, answer);
    if (move.then)
      s = this.sim.settle(
        this.sim.step(s, move.then.intent, move.then.as, this.rng, local) ?? s,
        this.rng,
        local,
        answer,
      );
    return s;
  }

  /**
   * A question in a try answered as the side asked would: the option that
   * leaves the table best for it once what follows is played out (any
   * question after that taking its first option).
   */
  private answerer(local: Map<number, GameState>): (s: GameState) => string | undefined {
    const first = (s: GameState) => s.script?.waiting?.options[0]?.id;
    return (s) => {
      const q = s.script?.waiting;
      if (!q || q.options.length < 2) return undefined;
      const sign = s.players[q.player]?.seat === this.seat ? 1 : -1;
      let pick: string | undefined;
      let top = -Infinity;
      for (const o of q.options) {
        const inner = new Map(local);
        const r = this.sim.step(s, { type: "script/answer", answer: o.id }, q.player, this.rng, inner);
        if (!r) continue;
        const v = sign * evaluate(this.sim.settle(r, this.rng, inner, first), this.judge);
        if (v > top) [pick, top] = [o.id, v];
      }
      return pick;
    };
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
        // In reserve, a unit can still take a code action that brings it on (a hidden model emerging) in a
        // game of plain activations, where it has a go to spend; it doesn't move or take data actions.
        (!u.status?.reserves || plain) &&
        // Plain activations: each unit has one go a round.
        !(plain && !u.status?.acting && u.status?.activated),
    );
    const slot = currentSlot(state)?.id ?? "";
    const fighting = /combat|fight|melee/i.test(slot);
    const out: Candidate[] = [];
    for (const u of units) {
      if (u.status?.reserves) continue;
      let moveAction = false;
      // A charge rolled that reaches: the move into contact comes next.
      const land = landing(state, u, !!this.answers);
      if (land) out.push({ move: land, key: `${u.id}:landing`, tries: 1, must: true });
      for (const o of unitActions(state, u.id)) {
        if (o.def.reactTo) continue;
        if (pointless(state, u, o.def.id)) continue;
        if (o.def.procedure) {
          const weapons = Object.keys(u.sheet?.weapons ?? {});
          // Targets that hang on the weapon (40k and FSD Indirect Fire, FSD arcs of fire) are asked per weapon.
          const shared = weaponTargets(o.def) ? null : targetsOf(state, u.id, o.def.id).filter((t) => t.ok);
          for (const weapon of weapons.length ? weapons : [undefined]) {
            if (weapon && wrongKind(u, weapon, o.def.id)) continue;
            const targets = (shared ?? targetsOf(state, u.id, o.def.id, weapon).filter((t) => t.ok)).filter(
              (t) => !weapon || reaches(state, u, weapon, t.unitId),
            );
            let repeat = 1;
            const usable = targets.filter((t) => {
              const req = { ...(weapon ? { weapon } : {}), targetId: t.unitId };
              const opt = unitActions(state, u.id, req).find((x) => x.def.id === o.def.id);
              if (opt?.repeat) repeat = opt.repeat;
              return !!opt?.ok;
            });
            const hazardous = !!weapon && hasKeyword(u, weapon, "hazardous");
            for (const [first, ...more] of aims(
              usable.map((t) => t.unitId),
              repeat,
            ))
              out.push({
                move: {
                  intent: {
                    type: "action/take",
                    unitId: u.id,
                    action: o.def.id,
                    ...(weapon ? { weapon } : {}),
                    targetId: first!,
                    ...(more.length ? { more } : {}),
                  },
                  as: u.owner,
                  kind: `action:${o.def.id}`,
                },
                key: `${u.id}:${o.def.id}:${weapon ?? ""}`,
                tries: this.tries,
                must: fighting && /fight|melee|strike/i.test(o.def.id),
                ...(hazardous ? { hazard: { unit: u.id, weapon: weapon! } } : {}),
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
          // Only the enemies the rules let it charge (40k within 12", Conquest in the front arc and in sight).
          const targets = o.def.target
            ? targetsOf(state, u.id, o.def.id)
                .filter((t) => t.ok)
                .slice(0, 3)
                .flatMap((t) => state.units[t.unitId] ?? [])
            : enemiesWithin(state, u, 12);
          const roll = o.move === undefined ? handCharge(state, u) : null;
          for (const e of targets) {
            const declared: BotMove = {
              ...take,
              intent: { ...take.intent, ...(o.def.target ? { targetId: e.id } : {}) } as Intent,
            };
            // Rolled and moved by hand (Conquest): roll the charge now; the move follows if it reaches.
            if (roll) {
              out.push({
                move: {
                  ...declared,
                  // Reviewing, the roll names its target, so the move that follows goes at it.
                  then: {
                    intent: (this.answers ? { ...roll, targets: [e.id] } : roll) as Intent,
                    as: u.owner,
                    kind: "roll",
                  },
                },
                key,
                tries: 1,
                charge: { unit: u.id, target: e.id },
              });
              continue;
            }
            const inches = o.move ?? 6 + 2 + Math.floor(this.rng() * 6);
            out.push({
              move: { ...declared, then: chargeMove(state, u, this.ctx, Math.max(1, inches), e.id) },
              key,
              tries: this.tries,
            });
          }
          continue;
        }
        if (o.move !== undefined) {
          moveAction = true;
          // Reviewing (#63), a unit that declared a charge makes the charge move or none (it marched or
          // reformed after one in tries); piling in and consolidating (40k) are moves of a fight.
          if (this.answers && u.status?.charged && !/pile|consolidat/i.test(o.def.id)) continue;
          // The move is in the system's unit (FSD: DU of 3").
          for (const then of destinations(state, u, Math.max(1, o.move) * inchesPerUnit(systemOf(state))))
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
      // Reviewing, a unit that charged this turn has made its move (TOW: it moved again in tries).
      if (
        !moveAction &&
        !(this.answers && u.status?.charged) &&
        (/move/i.test(slot) || plain) &&
        !unitActions(state, u.id).some((o) => o.move !== undefined)
      )
        for (const m of [
          ...destinations(state, u, moveInches(state, u, tuningOf(state.system))),
          // Up onto floors, in a game where height matters (BotTuning.climbs).
          ...(tuningOf(state.system)?.climbs
            ? perches(state, u, moveInches(state, u, tuningOf(state.system)))
            : []),
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
    if (placeablePool(systemOf(state)))
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
                const available = pointsShort(state, a, u.id) ?? a.available(view, actor);
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
            move: charge
              ? {
                  ...move,
                  then: chargeMove(
                    state,
                    u,
                    this.ctx,
                    this.answers ? chargeReach(state, u, this.rng) : 24,
                    target,
                  ),
                }
              : move,
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
