import type { GameState, Model, Unit } from "../core";
import { maxWounds, woundsRemaining } from "../core/attack";
import { systemOf } from "../core/content/turn";
import { inchesPerUnit } from "../core/content/runtime";
import type { BotTuning, Mission } from "../sdk";

export type { BotTuning } from "../sdk";

/**
 * How a computer opponent (#45) judges a table, from one side: victory
 * points scored, the points the mission would give each side if it scored
 * now (holding objectives, enemies destroyed), the army each side still has,
 * and how near its units are to the objectives. Higher is better for `seat`.
 * Never shown to players: it is the bot's own sense of how things stand.
 */

export interface Weights {
  /** How much the next scoring moment's projection counts, and each one after it. */
  projectNext: number;
  projectLater: number;
  /** Pull towards objectives nobody holds yet, per inch, in VP. */
  approach: number;
  /**
   * Who could hold each objective by the next scoring: every unit near it
   * counts, fading out over a move beyond it, as a share of one objective's
   * worth in a round. What makes the bot go for objectives, not just sit near.
   */
  contest: number;
  /** Units that fight only hand to hand want to close with the enemy: their share of the army's worth, per move nearer. */
  engage: number;
  /** Threat: VP per unit of enemy value in reach of my units, minus mine in theirs. */
  threat: number;
  /**
   * The share of a unit's worth that goes only when the last model falls, so
   * finishing a unit off beats spreading wounds around.
   */
  finish: number;
}

export const STEADY: Weights = {
  projectNext: 0.9,
  projectLater: 0.3,
  approach: 0.04,
  contest: 1,
  engage: 0.3,
  threat: 0.3,
  finish: 0,
};
export const SHARP: Weights = {
  projectNext: 1,
  projectLater: 0.45,
  approach: 0.05,
  contest: 1,
  engage: 0.3,
  threat: 0.3,
  finish: 0.35,
};

const standing = (state: GameState, u: Unit): Model[] => {
  const out: Model[] = [];
  for (const id of u.modelIds) {
    const m = state.models[id];
    if (m && !m.destroyed) out.push(m);
  }
  return out;
};

const seatOf = (state: GameState, u: Unit) => state.players[u.owner]?.seat;

const inches = (s: string | undefined) => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : undefined;
};

/**
 * How far a unit shoots, in inches (0 if it only fights): its longest ranged
 * weapon, or a Range on its models' profile (games whose models carry one
 * shooting stat, like Rift Lanterns).
 */
export function rangeOf(state: GameState, u: Unit): number {
  return rangeIn(state, u) * inchesPerUnit(systemOf(state));
}

/** The longest range, in the system's own unit (FSD: DU). */
function rangeIn(state: GameState, u: Unit): number {
  let r = 0;
  for (const w of Object.values(u.sheet?.weapons ?? {})) {
    if (w.kind === "melee") continue;
    r = Math.max(r, inches(w.chars.RANGE ?? w.chars.Range ?? w.chars.R) ?? 0);
  }
  const m = standing(state, u)[0];
  const c = m?.profile?.chars;
  if (c) r = Math.max(r, inches(c.Range ?? c.RANGE ?? c.Rng) ?? 0);
  return r;
}

/** A unit's full worth: its points, or its models' wounds (a module can say otherwise). */
function unitWorth(state: GameState, u: Unit, tuning?: BotTuning): number {
  if (tuning?.unitValue) return tuning.unitValue(state, u);
  const pts = u.sheet?.points;
  if (pts && pts > 0) return pts;
  return u.modelIds.reduce((n, id) => n + (state.models[id] ? maxWounds(state.models[id]!) : 1), 0) * 10;
}

/** The share of a unit still standing, by wounds left. */
function health(state: GameState, u: Unit): number {
  let left = 0;
  let all = 0;
  for (const id of u.modelIds) {
    const m = state.models[id];
    if (!m) continue;
    all += maxWounds(m);
    if (!m.destroyed) left += woundsRemaining(m);
  }
  return all > 0 ? left / all : 0;
}

/** What a side's army is worth now. */
export function armyValue(state: GameState, seat: number, tuning?: BotTuning, finish = 0): number {
  let v = 0;
  for (const u of Object.values(state.units)) {
    if (seatOf(state, u) !== seat) continue;
    const h = health(state, u);
    v += unitWorth(state, u, tuning) * ((1 - finish) * h + (h > 0 ? finish : 0));
  }
  return v;
}

const centre = (ms: Model[]) => ({
  x: ms.reduce((a, m) => a + m.position.x, 0) / ms.length,
  y: ms.reduce((a, m) => a + m.position.y, 0) / ms.length,
});

export interface Judge {
  seat: number;
  mission?: Mission;
  tuning?: BotTuning;
  weights: Weights;
  /** Each side's whole army at the start, for weighing losses. */
  armies: Record<number, number>;
  /** VP a whole army is worth. */
  armyVp: number;
  /** Rounds in the battle. */
  rounds: number;
  /** Ranged reach of each unit in inches (worked out once). */
  reach?: (state: GameState, u: Unit) => number;
  /** How far a unit moves in a turn, in inches. */
  move?: (state: GameState, u: Unit) => number;
}

export function judge(
  start: GameState,
  seat: number,
  weights: Weights,
  mission?: Mission,
  tuning?: BotTuning,
): Judge {
  const rounds = systemOf(start).turn.rounds;
  const r = typeof rounds === "number" ? rounds : 5;
  const armies: Record<number, number> = {};
  for (const u of Object.values(start.units)) {
    const s = seatOf(start, u);
    if (s !== undefined) armies[s] = (armies[s] ?? 0) + unitWorth(start, u, tuning);
  }
  // A whole army is worth about as much as holding everything for the whole battle.
  const objectives = Math.max(1, start.objectives.length);
  const armyVp = tuning?.armyVp ?? Math.max(6, r * objectives * 1.5);
  return { seat, mission, tuning, weights, armies, armyVp, rounds: r };
}

/** The scores the mission would give each side if every scoring moment came now, weighted by how soon. */
function projected(state: GameState, j: Judge, seats: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  const m = j.mission;
  if (!m) return out;
  const left = Math.max(0, j.rounds - Math.max(1, state.turn.round));
  for (const rule of m.scoring) {
    const later = "gameEnd" in rule.at ? 0 : left;
    const weight = "gameEnd" in rule.at ? 1 : j.weights.projectNext + j.weights.projectLater * later;
    for (const s of seats) {
      let vp: number;
      try {
        vp = rule.suggest(state, s)?.vp ?? 0;
      } catch {
        vp = 0;
      }
      out[s] = (out[s] ?? 0) + vp * weight;
    }
  }
  return out;
}

/** How the table looks for `j.seat`: higher is better. */
export function evaluate(state: GameState, j: Judge): number {
  const seats = Object.keys(j.armies).map(Number);
  const enemySeats = seats.filter((s) => s !== j.seat);
  // VP already scored.
  const vp: Record<number, number> = {};
  for (const s of state.scores ?? []) vp[s.seat] = (vp[s.seat] ?? 0) + s.vp;
  const proj = projected(state, j, seats);
  const side = (s: number) =>
    (vp[s] ?? 0) +
    (proj[s] ?? 0) +
    (armyValue(state, s, j.tuning, j.weights.finish) / (j.armies[s] || 1)) * j.armyVp;
  let score = side(j.seat);
  for (const s of enemySeats) score -= side(s) / enemySeats.length;
  score += position(state, j);
  if (j.tuning?.evaluate) score += j.tuning.evaluate(state, j.seat);
  return score;
}

/** Nearness to objectives (each one's nearest unit of mine, against theirs), and threats. */
function position(state: GameState, j: Judge): number {
  const mine: { c: { x: number; y: number }; u: Unit; v: number }[] = [];
  const theirs: typeof mine = [];
  for (const u of Object.values(state.units)) {
    const ms = standing(state, u);
    if (!ms.length || u.status?.reserves) continue;
    const s = seatOf(state, u);
    if (s === undefined) continue;
    const e = { c: centre(ms), u, v: unitWorth(state, u, j.tuning) * health(state, u) };
    (s === j.seat ? mine : theirs).push(e);
  }
  let score = 0;
  const move = (u: Unit) => Math.max(1, j.move?.(state, u) ?? 6);
  // One objective held for a round, in VP: the share of a whole army's worth it makes up.
  const objectiveVp = j.armyVp / Math.max(1, j.rounds * Math.max(1, state.objectives.length));
  const left = state.turn.round <= j.rounds;
  for (const o of state.objectives) {
    const near = (xs: typeof mine) =>
      xs.reduce((d, e) => Math.min(d, Math.hypot(e.c.x - o.position.x, e.c.y - o.position.y)), 60);
    score += j.weights.approach * (near(theirs) - near(mine));
    if (!j.weights.contest || !left) continue;
    const pull = (xs: typeof mine) =>
      xs.reduce((n, e) => {
        const d = Math.max(0, Math.hypot(e.c.x - o.position.x, e.c.y - o.position.y) - 3);
        return n + standing(state, e.u).length * Math.max(0, 1 - d / move(e.u));
      }, 0);
    const a = pull(mine);
    const b = pull(theirs);
    score += j.weights.contest * objectiveVp * ((a - b) / (a + b + 1));
  }
  if (j.weights.engage) {
    const total = j.armies[j.seat] || 1;
    for (const e of mine) {
      if (rangeOf(state, e.u) > 0) continue;
      let d = Infinity;
      for (const t of theirs) d = Math.min(d, Math.hypot(t.c.x - e.c.x, t.c.y - e.c.y));
      if (!Number.isFinite(d)) continue;
      // Nearer by a move is worth this unit's share of the army, scaled by `engage`.
      score -= j.weights.engage * (e.v / total) * j.armyVp * Math.min(3, d / (move(e.u) * 3));
    }
  }
  if (j.weights.threat && j.reach) {
    // How surely something of `by` can reach each of `xs` (fading over the last 6"), by value.
    const value = (xs: typeof mine, by: typeof mine) => {
      const reach = by.map((e) => j.reach!(state, e.u));
      let v = 0;
      for (const t of xs) {
        let f = 0;
        by.forEach((e, i) => {
          const d = Math.hypot(e.c.x - t.c.x, e.c.y - t.c.y);
          f = Math.max(f, Math.min(1, Math.max(0, (reach[i]! - d) / 6 + 0.5)));
        });
        v += t.v * f;
      }
      return v;
    };
    const norm = (s: number) => j.armyVp / (j.armies[s] || 1);
    const enemy =
      Object.keys(j.armies)
        .map(Number)
        .find((s) => s !== j.seat) ?? 1 - j.seat;
    score += j.weights.threat * (value(theirs, mine) * norm(enemy) - value(mine, theirs) * norm(j.seat));
  }
  return score;
}
