import {
  applyEvent,
  sidePlayers,
  sides,
  undoneSeqs,
  type GameEvent,
  type GameRecord,
  type GameState,
  type Intent,
  type LoggedEvent,
  type PlayerId,
} from "../core";
import { phaseName, systemOf } from "../core/content/turn";
import { analyst, usedKey, type Analyst } from "../bot/player";
import { battleOver, phaseKey, type BotMove } from "../soak/bot";
import { decisionKind, trusted, type DecisionKind } from "./trust";

/**
 * Game review (roadmap #61): a finished game read back decision by
 * decision, as a chess site reviews a game. Each choice a side made is
 * judged against the others it had, by the Sharp computer opponent's eye
 * (#45, #51): what it was worth on average, what the best one found was
 * worth, and so what it cost. Rolls are judged too: how far the dice took
 * a side above or below what that choice was worth on average. Out of that
 * come the expected-result line across the game and its turning points.
 *
 * Data only, in the evaluator's units (victory points, roughly): the panel
 * words it. Never run during live play.
 */

export type MarkKind = "costly" | "strong" | "missed" | "dice";

export interface Decision {
  /** The log entry the decision starts at, and the last one it covers (its move, its rolls). */
  seq: number;
  endSeq: number;
  seat: number;
  player: PlayerId;
  round: number;
  /** The phase's name, as the system calls it. */
  phase: string;
  /** What was played: null when the side moved the game on (▶) while it still had something worth doing. */
  played: BotMove | null;
  /** The best option found, and what it and the played one were worth on average. */
  best: BotMove | null;
  bestScore: number;
  playedScore: number;
  /** What the choice gave up against the best (0 or more). */
  loss: number;
  /** What it was worth against the best other choice (another unit, action or target). */
  gain: number;
  /** How far the dice took it from its average (above 0 is lucky). */
  luck: number;
  options: number;
  /** Judged with the rest of the turn played out (moves). */
  deep: boolean;
  /** What kind of choice it was, and whether the review benchmark backs judging that kind in this game (trust.ts). */
  kind: DecisionKind;
  trusted: boolean;
}

export interface Mark {
  kind: MarkKind;
  /** Index into `decisions`. */
  decision: number;
  /** How big, in the evaluator's units. */
  size: number;
}

export interface GamePoint {
  seq: number;
  round: number;
  /** Seat 0's expected result, from 0 (a sure loss) to 1 (a sure win). */
  p: number;
}

export interface GameReview {
  seats: number[];
  /**
   * The yardstick for sizes, in VP: what a whole army is worth on the evaluator's scale, or half
   * the VP the game scored where that's more (The Old World scores units' points).
   */
  scale: number;
  decisions: Decision[];
  marks: Mark[];
  points: GamePoint[];
  /** Per seat: the sum of what decisions cost, how many were judged, and the dice's total. */
  totals: Record<number, { loss: number; judged: number; luck: number; costly: number; strong: number }>;
}

/** Sizes as shares of a whole army's worth on the evaluator's scale. */
const COSTLY = 0.06;
const STRONG = 0.05;
const MISSED = 0.06;
const DICE = 0.08;
/** The expected-result curve: how much of an army's worth ahead counts as a near-certain win. */
const SPREAD = 0.6;

interface Options {
  /** Called now and then with the share done (0–1). */
  onProgress?: (done: number) => void;
  /** Stop early: a review abandoned when the panel closes. */
  cancelled?: () => boolean;
  /** Fewer dice per option for a quicker review (tests). */
  tries?: number;
  /** Goes of the rest of the turn for each move judged. */
  passes?: number;
  /** This worker's share of the decisions, [k, n]: every nth from the kth (mergeReviews joins the shares). */
  part?: [number, number];
}

const take = (e: Extract<GameEvent, { type: "action/take" }>): Intent => ({
  type: "action/take",
  unitId: e.unitId,
  action: e.action,
  ...(e.weapon ? { weapon: e.weapon } : {}),
  ...(e.targetId ? { targetId: e.targetId } : {}),
  ...(e.more?.length ? { more: e.more } : {}),
  ...(e.with?.length ? { with: e.with } : {}),
});

/** A decision's move as the bot would make it, from the log entry that starts it (null if it isn't one). */
export function decisionAt(state: GameState, logged: LoggedEvent): BotMove | null {
  const e = logged.event;
  const as = logged.by;
  if (!as || !state.players[as]) return null;
  if (e.type === "action/take") return { intent: take(e), as, kind: "played" };
  // A shot or blow declared in the attack panel is the same choice as the shoot or fight action the
  // computer takes; without it a player's attacks went unjudged, and the unit read as still to shoot.
  if (e.type === "attack/declare") {
    const spec = e.attack.spec;
    const action = spec.kind === "ranged" ? "shoot" : "fight";
    if (!systemOf(state).actions.some((a) => a.id === action)) return null;
    return {
      intent: {
        type: "action/take",
        unitId: spec.attackerUnitId,
        action,
        weapon: spec.weaponId,
        targetId: spec.targetUnitId,
      },
      as,
      kind: "played",
    };
  }
  if (e.type === "models/move")
    return { intent: { type: "models/move", moves: e.moves }, as, kind: "played" };
  if (e.type === "player/action")
    return {
      intent: { type: "player/action", action: e.action, ...(e.targetId ? { targetId: e.targetId } : {}) },
      as,
      kind: "played",
    };
  // A code action's first step (not a hook's): its id, and the unit (and target) it was for.
  if (e.type === "script/step" && e.started && !e.started.startsWith("hook:") && e.unit) {
    // A code action that ended at once has no script left: the step keeps its unit and target.
    const args =
      e.script?.procedure === e.started
        ? e.script.args
        : { unit: e.unit, ...(e.target ? { target: e.target } : {}) };
    return { intent: { type: "script/start", procedure: e.started, args }, as, kind: "played" };
  }
  return null;
}

/** An action that moves the unit: its move follows in the next entry from the same player. */
function movesNext(state: GameState, m: BotMove): boolean {
  const i = m.intent;
  if (i.type === "script/start") return /charge/i.test(i.procedure);
  if (i.type !== "action/take") return false;
  const def = systemOf(state).actions.find((a) => a.id === i.action);
  return (
    !!def &&
    !def.procedure &&
    (def.move !== undefined || /move|advance|charge|pile|consolidate|fall/i.test(def.id))
  );
}

const expected = (v: number, army: number) => 1 / (1 + Math.exp(-v / Math.max(1e-6, SPREAD * army)));

/**
 * A decision judged as the review judges it: a look, and at a turning point (a
 * costly mark in the making) a closer one, so luck in the few goes tried
 * doesn't make one. The review benchmark (bench/) judges its plays so too.
 */
export function lookAt(
  eye: Analyst,
  record: GameRecord,
  st: GameState,
  move: BotMove | null,
  keys: Set<string>,
  scale: number,
): ReturnType<Analyst["appraise"]> {
  const a = eye.appraise(record, st, move, keys);
  const gap = (a.best?.score ?? a.base) - (move ? (a.played ?? a.base) : a.base);
  return gap >= COSTLY * scale ? eye.appraise(record, st, move, keys, true) : a;
}

export async function reviewGame(record: GameRecord, opts: Options = {}): Promise<GameReview> {
  const undone = undoneSeqs(record);
  const events = record.events.filter((e) => !undone.has(e.seq) && e.event.type !== "undo");
  // The table before each entry, and after the last.
  const states: GameState[] = [];
  let s = record.initial;
  for (const e of events) {
    states.push(s);
    s = { ...applyEvent(s, e.event), seq: e.seq };
  }
  const end = s;
  const seats = sides(end).filter((x) => x === 0 || x === 1);
  const start = states.find((x) => x.turn.round > 0) ?? end;
  const eyes = new Map<number, Analyst>(
    seats.map((seat) => [
      seat,
      analyst(start, seat, {
        ...(opts.tries ? { tries: opts.tries } : {}),
        ...(opts.passes ? { planPasses: opts.passes } : {}),
      }),
    ]),
  );
  const seatOf = (p: PlayerId | undefined, st: GameState) => (p ? st.players[p]?.seat : undefined);
  const review: GameReview = {
    seats,
    scale: Math.max(
      1,
      ...seats.map((x) => eyes.get(x)!.armyVp),
      (end.scores ?? []).reduce((a, x) => a + Math.max(0, x.vp), 0) / 2,
    ),
    decisions: [],
    marks: [],
    points: [],
    totals: Object.fromEntries(seats.map((x) => [x, { loss: 0, judged: 0, luck: 0, costly: 0, strong: 0 }])),
  };
  const first = eyes.get(seats[0] ?? 0);
  const point = (seq: number, st: GameState) => {
    if (!first) return;
    review.points.push({ seq, round: st.turn.round, p: expected(first.value(st), review.scale) });
  };
  const used = new Map<number, { phase: string; keys: Set<string> }>();
  const usedFor = (seat: number, st: GameState) => {
    const phase = phaseKey(st);
    let u = used.get(seat);
    if (!u || u.phase !== phase) used.set(seat, (u = { phase, keys: new Set() }));
    return u.keys;
  };
  const upTo = (i: number): GameRecord => ({ ...record, events: events.slice(0, i) });
  const pending: { d: Decision; seat: number }[] = [];
  const settle = (i: number) => {
    // Decisions whose rolls are done: the dice's part is the table now against the average.
    const after = i < events.length ? states[i]! : end;
    while (pending.length) {
      const { d, seat } = pending.shift()!;
      d.endSeq = i > 0 ? events[i - 1]!.seq : d.seq;
      const now = eyes.get(seat)!.value(after);
      if (d.played && rolled(events, d.seq, d.endSeq)) d.luck = now - d.playedScore;
    }
  };
  let lastYield = 0;
  let count = 0;
  for (let i = 0; i < events.length; i++) {
    if (opts.cancelled?.()) break;
    const logged = events[i]!;
    const st = states[i]!;
    if (st.turn.round === 0 || battleOver(st) || st.script?.waiting) continue;
    const isNext = logged.event.type === "turn/next";
    const seat = seatOf(logged.by, st);
    let move = isNext ? null : decisionAt(st, logged);
    if (!isNext && !move) continue;
    if (seat === undefined || !eyes.has(seat)) continue;
    // A side moving the game on only counts in its own turn.
    if (isNext && st.turn.activeSeat !== seat) continue;
    settle(i);
    point(logged.seq, st);
    let j = i;
    if (move && movesNext(st, move)) {
      const k = events.findIndex(
        (x, n) =>
          n > i && x.by === logged.by && x.event.type !== "procedure/set" && x.event.type !== "script/step",
      );
      const next = k > 0 ? events[k]! : null;
      if (next?.event.type === "models/move") {
        move = {
          ...move,
          then: { intent: { type: "models/move", moves: next.event.moves }, as: logged.by!, kind: "played" },
        };
        j = k;
      } else if (next?.event.type === "unit/move" || next?.event.type === "unit/form") {
        // A block moved as one (Conquest, The Old World): without it a march read as a march nowhere (#66).
        move = { ...move, then: { intent: { ...next.event }, as: logged.by!, kind: "played" } };
        j = k;
      }
    }
    const keys = usedFor(seat, st);
    const eye = eyes.get(seat)!;
    // Another worker's share: only what it uses up this phase matters here.
    if (opts.part && count++ % opts.part[1] !== opts.part[0]) {
      const key = move ? usedKey(st, move) : undefined;
      if (key) keys.add(key);
      i = j;
      continue;
    }
    const a = lookAt(eye, upTo(i), st, move, keys, review.scale);
    if (a.key) keys.add(a.key);
    const bestScore = a.best?.score ?? a.base;
    const playedScore = move ? (a.played ?? bestScore) : a.base;
    const d: Decision = {
      seq: logged.seq,
      endSeq: logged.seq,
      seat,
      player: logged.by!,
      round: st.turn.round,
      phase: phaseName(st) ?? "",
      played: move,
      best: a.best?.move ?? null,
      bestScore,
      playedScore,
      loss: Math.max(0, bestScore - playedScore),
      gain: playedScore - (a.second ?? a.median),
      luck: 0,
      options: a.options,
      deep: !!a.deep,
      kind: decisionKind(move),
      trusted: trusted(systemOf(st).id, decisionKind(move)),
    };
    // Moving on with nothing worth doing left isn't a decision worth showing.
    if (!move && d.loss < MISSED * review.scale) {
      i = j;
      continue;
    }
    review.decisions.push(d);
    pending.push({ d, seat });
    if (j > i) i = j;
    if (opts.onProgress && i - lastYield > 8) {
      lastYield = i;
      opts.onProgress(i / events.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  settle(events.length);
  point(events.at(-1)?.seq ?? record.initial.seq, end);
  // A finished game ends where it ended: the side with more VP won (UX: a 6–4 game read "53%" at the end).
  const last = review.points.at(-1);
  if (last && battleOver(end)) {
    const vp = (seat: number) => end.resources[sidePlayers(end, seat)[0]?.id ?? ""]?.VP ?? 0;
    const [a, b] = [vp(seats[0] ?? 0), vp(seats[1] ?? 1)];
    if (a || b) last.p = a > b ? 1 : a < b ? 0 : 0.5;
  }
  if (!opts.part) markUp(review);
  opts.onProgress?.(1);
  return review;
}

/** Shares of one review, worked out side by side, made whole. */
export function mergeReviews(parts: GameReview[]): GameReview {
  const first = parts[0]!;
  const review: GameReview = {
    ...first,
    decisions: parts.flatMap((p) => p.decisions).sort((a, b) => a.seq - b.seq),
    marks: [],
    totals: Object.fromEntries(
      first.seats.map((x) => [x, { loss: 0, judged: 0, luck: 0, costly: 0, strong: 0 }]),
    ),
  };
  markUp(review);
  return review;
}

/** Whether any dice were rolled between two entries. */
function rolled(events: LoggedEvent[], from: number, to: number): boolean {
  return events.some(
    (e) =>
      e.seq >= from &&
      e.seq <= to &&
      (e.event.type === "procedure/set" ||
        e.event.type === "dice/roll" ||
        (e.event.type === "action/take" && !!e.event.run) ||
        (e.event.type === "script/step" && JSON.stringify(e.event).includes('"dice/roll"'))),
  );
}

/** The turning points: the costly and strong choices, the missed chances and the big rolls. */
function markUp(review: GameReview): void {
  review.decisions.forEach((d, n) => {
    const army = review.scale;
    const t = review.totals[d.seat]!;
    if (d.played) {
      t.loss += d.loss;
      t.judged++;
    }
    t.luck += d.luck;
    if (!d.played) review.marks.push({ kind: "missed", decision: n, size: d.loss });
    // Costly and strong only where the review benchmark backs the judgement (#63, trust.ts).
    else if (d.trusted && d.loss >= COSTLY * army) {
      review.marks.push({ kind: "costly", decision: n, size: d.loss });
      t.costly++;
    } else if (d.trusted && d.gain >= STRONG * army && d.loss < 0.005 * army && d.options > 2) {
      review.marks.push({ kind: "strong", decision: n, size: d.gain });
      t.strong++;
    }
    if (Math.abs(d.luck) >= DICE * army) review.marks.push({ kind: "dice", decision: n, size: d.luck });
  });
}
