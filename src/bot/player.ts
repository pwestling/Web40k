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
}

/** The module's tuning for the bot, if it has any. */
function tuningOf(system: string | undefined): BotTuning | undefined {
  return gameModule(system)?.bot;
}

export function botPolicy(level: Level, start: GameState, seat: number, opts: BotOptions): Policy {
  const kept = opts.kept ?? new Map();
  const rng = seededRng(opts.seed);
  const ctx: BotContext & { mark?: string } = {
    rng,
    kept,
    idle: 0,
    tidy: true,
    // A package game with no data actions: units head for the enemy and try their code actions.
    ...(systemOf(start).actions.length ? {} : { wholeGame: true }),
    ...(opts.packageActions ? { packageActions: opts.packageActions } : {}),
  };
  return guarded(
    level === "random" ? randomPolicy(ctx, seat) : new Thinker(level, start, seat, ctx, rng, opts),
    seat,
  );
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

/** What a command point is worth, as a share of a whole army's worth in VP. */
const CP_WORTH = 0.01;

const DBG = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BOT_DBG;
class Thinker implements Policy {
  readonly name: string;
  private readonly sim: Sim;
  private readonly judge: Judge;
  private readonly tries: number;
  /** Sharp: how many of the best moves are judged with what could follow them. */
  private readonly beam: number;
  private done = { phase: "", keys: new Set<string>(), decisions: 0 };
  private readonly weigh: BotContext;

  constructor(
    level: Level,
    start: GameState,
    private readonly seat: number,
    private readonly ctx: BotContext & { mark?: string },
    private readonly rng: Rng,
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
    this.weigh = { ...ctx, weighing: true };
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
    if (state.turn.activeSeat !== this.seat) return null;
    const phase = phaseKey(state);
    if (this.done.phase !== phase) this.done = { phase, keys: new Set(), decisions: 0 };
    this.done.decisions++;
    // Drawing the next command card (Conquest): there's nothing to weigh.
    for (const m of commandStack(state, this.ctx, [...mine]))
      if (m.kind === "draw" && legal(record, state, m)) return m;
    const onward = this.onward(record, state, mine);
    if (this.done.decisions > 120) return onward;
    const candidates = this.candidates(state, mine).filter((c) => !c.key || !this.done.keys.has(c.key));
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
  private candidates(state: GameState, mine: Set<PlayerId>): Candidate[] {
    const acting = actingUnits(state).filter((u) => mine.has(u.owner));
    const plain = plainActivations(state);
    const units = (acting.length ? acting : Object.values(state.units)).filter(
      (u) =>
        mine.has(u.owner) &&
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
    // Stratagems and other player actions, re-rolls aside (kept for a roll worth re-rolling).
    for (const p of mine)
      for (const o of playerActions(state, p)) {
        if (!o.ok || o.def.custom || /re.?roll/i.test(o.def.id)) continue;
        // A faction stratagem that does something it can weigh: only on a unit that can still act.
        const army = o.def.id.startsWith("army:") && o.def.do?.length;
        if (o.def.id.startsWith("army:") && !army) continue;
        const cp = o.payment.reduce((n, x) => n + (x.resource === "CP" ? (x.amount ?? 0) : 0), 0);
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
