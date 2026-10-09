import { chargeFor } from "./charge";
import { phaseName } from "./content/turn";
import { undoneSeqs, type GameRecord } from "./log";
import { rareMoments } from "./rare";
import { applyEvent } from "./reducer";
import { gameStats } from "./stats";
import type { GameState, PlayerId, UnitId } from "./types";

/**
 * Moments of the game (PX-4): what players retell afterwards, picked from the
 * event log alone, so every peer and every replay of a game gets the same
 * reel. Shown only once a game is over and in replays, never during play, so
 * a card may carry one odds figure as small print.
 */

export type MomentKind = "rare" | "swing" | "wipe" | "last" | "charge" | "giant" | "turning" | "mvp";

export interface Moment {
  kind: MomentKind;
  /** Where the moment starts: replays play it from here... */
  seq: number;
  /** ...to here (the same event for a single roll or move). */
  end: number;
  round: number;
  /** "Round 2 · Shooting". */
  when: string;
  title: string;
  /** One line, past tense, names units and players. */
  line: string;
  /** Whose moment it is (the reel gives each player at least one). */
  player?: PlayerId;
  units: UnitId[];
  /** When its story is settled, if later than `end`: a round card lists it under that round (UX 393). */
  settled?: number;
  /** How big a moment it is, for picking the reel. */
  score: number;
}

/** How each kind ranks against the others when picking the reel. */
const RANK: Record<MomentKind, number> = {
  rare: 100,
  wipe: 80,
  swing: 70,
  charge: 60,
  giant: 55,
  last: 50,
  turning: 40,
  mvp: 0,
};

const points = (s: GameState, unit: UnitId) => s.units[unit]?.sheet?.points ?? 0;
const aliveIn = (s: GameState, unit: UnitId) =>
  (s.units[unit]?.modelIds ?? []).filter((id) => s.models[id] && !s.models[id]!.destroyed).length;
const nameOf = (s: GameState, unit: UnitId | undefined) => (unit && s.units[unit]?.name) || "A unit";
const inches = (n: number) => `${Number(n.toFixed(1))}"`;

/** The unit an attack or procedure is acting for, if one is running. */
function actor(s: GameState): { unit?: UnitId; target?: UnitId; key: string } | null {
  const run = s.attack?.run ?? s.procedure?.run;
  if (s.attack && !run)
    return { unit: s.attack.spec.attackerUnitId, target: s.attack.spec.targetUnitId, key: "attack" };
  if (!run) return null;
  const role = (r: string) => {
    const v = run.roles[r];
    return v && "unit" in v ? v.unit : undefined;
  };
  return {
    unit: role("attacker") ?? role("unit"),
    target: role("target") ?? role("defender"),
    key: `${run.procedure}:${JSON.stringify(run.roles)}`,
  };
}

/** Every candidate moment in the game, in game order. */
function momentCandidates(record: GameRecord): Moment[] {
  const undone = undoneSeqs(record);
  const out: Moment[] = [];
  let state = record.initial;
  // The run going on, and the target's models standing when it began.
  let run = null as {
    key: string;
    seq: number;
    last: number;
    unit?: UnitId;
    target?: UnitId;
    standing: number;
  } | null;
  // Every attack or procedure, first event to last, so a moment can play through to its result.
  const runs: { seq: number; end: number }[] = [];
  const close = (r: NonNullable<typeof run>) => runs.push({ seq: r.seq, end: r.last });
  // When each unit last rolled its charge, so a charge plays from the roll.
  const chargeRolled = new Map<UnitId, number>();
  // Units down to one model: since when, and how many enemy attacks it has lived through since.
  const alone = new Map<UnitId, { seq: number; round: number; survived: number }>();
  const killed: Record<UnitId, { units: Set<UnitId>; pts: number; seq: number }> = {};
  let longest = null as Moment | null;
  const when = (s: GameState) => {
    const phase = phaseName(s);
    return `Round ${Math.max(1, s.turn.round)}${phase ? ` · ${phase}` : ""}`;
  };

  // An attack on a lone model that it lived through (not the one that left it alone).
  const survive = (r: NonNullable<typeof run>, s: GameState) => {
    const lone = r.target ? alone.get(r.target) : undefined;
    if (lone && r.seq > lone.seq && aliveIn(s, r.target!) > 0) lone.survived++;
  };
  const stats = gameStats(record);

  for (const { seq, event } of record.events) {
    if (undone.has(seq)) continue;
    const before = state;
    state = applyEvent(state, event);
    const round = Math.max(1, state.turn.round);
    const act = actor(state);
    if (act && act.key !== run?.key) {
      // A new attack: a unit on its own that was targeted by the last one has lived through it.
      if (run) {
        survive(run, state);
        close(run);
      }
      run = {
        key: act.key,
        seq,
        last: seq,
        unit: act.unit,
        target: act.target,
        standing: act.target ? aliveIn(before, act.target) : 0,
      };
    } else if (!act && run) {
      survive(run, state);
      close(run);
      run = null;
    } else if (run) run.last = seq;
    for (const [id, u] of Object.entries(state.units)) {
      const rolled = u.status?.charge;
      if (rolled !== undefined && rolled !== before.units[id]?.status?.charge) chargeRolled.set(id, seq);
    }

    // Charges: the longest one that struck home, if it needed 9" or more.
    const charge = chargeFor(event, before, state);
    if (
      charge?.target &&
      charge.over === null &&
      charge.distance >= 9 &&
      (!longest || charge.distance > Number(longest.score))
    ) {
      const target = state.models[charge.target.ids[0] ?? ""]?.unitId;
      const owner = state.units[charge.unitId]?.owner;
      longest = {
        kind: "charge",
        seq: chargeRolled.get(charge.unitId) ?? seq,
        end: seq,
        round,
        when: when(state),
        title: charge.distance >= 11.5 ? `${Math.round(charge.distance)}-inch charge` : "The long charge",
        line: `${nameOf(state, charge.unitId)} made a ${inches(charge.distance)} charge into ${nameOf(state, target)}`,
        player: owner,
        units: [charge.unitId, ...(target ? [target] : [])],
        score: charge.distance,
      };
    }

    for (const unit of Object.values(state.units)) {
      const was = aliveIn(before, unit.id);
      const now = aliveIn(state, unit.id);
      if (was === now) continue;
      if (now === 1 && was > 1 && unit.modelIds.length > 1) alone.set(unit.id, { seq, round, survived: 0 });
      const by = run?.target === unit.id ? run.unit : undefined;
      const byOwner = by ? state.units[by]?.owner : undefined;
      const credited = by && byOwner && byOwner !== unit.owner ? by : undefined;
      // Points destroyed, model by model, for the most valuable unit.
      if (credited && now < was) {
        const k = (killed[credited] ??= { units: new Set(), pts: 0, seq });
        k.pts += ((was - now) * points(state, unit.id)) / Math.max(1, unit.modelIds.length);
        k.seq = seq;
      }
      if (now > 0 || was === 0) continue;
      // Destroyed in this event.
      const lone = alone.get(unit.id);
      if (lone && lone.survived > 0)
        out.push({ ...lastStanding(state, unit.id, lone, round, false), settled: seq });
      alone.delete(unit.id);
      if (by && credited) {
        killed[by]!.units.add(unit.id);
        // Wiped out in one go: every model standing when the attack began.
        if (run && run.standing === unit.modelIds.length && run.standing > 1)
          out.push({
            kind: "wipe",
            seq: run.seq,
            end: seq,
            round,
            when: when(state),
            title: "Gone in one go",
            line: `${nameOf(state, by)} wiped out ${unit.name}${points(state, unit.id) ? ` (${points(state, unit.id)} pts)` : ""}`,
            player: byOwner,
            units: [by, unit.id],
            score: RANK.wipe + points(state, unit.id) / 50,
          });
        const mine = points(state, by);
        const theirs = points(state, unit.id);
        if (mine > 0 && theirs >= 2 * mine)
          out.push({
            kind: "giant",
            seq: run?.seq ?? seq,
            end: seq,
            round,
            when: when(state),
            title: "Giant-killer",
            line: `${nameOf(state, by)} (${mine} pts) brought down ${unit.name} (${theirs} pts)`,
            player: byOwner,
            units: [by, unit.id],
            score: RANK.giant + theirs / mine,
          });
      }
    }
  }

  if (run) close(run);
  // Plays through to the end of the attack it is part of.
  const through = (m: Moment): Moment => {
    const r = runs.find((r) => r.seq <= m.seq && m.seq <= r.end);
    return r && r.end > m.end ? { ...m, end: r.end } : m;
  };
  for (const [i, m] of out.entries()) out[i] = through(m);

  // A lone model still standing at the end.
  for (const [unit, lone] of alone)
    if (aliveIn(state, unit) === 1)
      out.push({
        ...lastStanding(state, unit, lone, stats.rounds, true),
        settled: record.events.at(-1)?.seq ?? lone.seq,
      });
  if (longest) out.push({ ...longest, score: RANK.charge + longest.score });

  // Rare dice, from the same rules the tray uses.
  for (const r of rareMoments(record))
    out.push({
      kind: "rare",
      seq: r.seq,
      end: r.seq,
      round: Math.max(1, r.round),
      when: whenAt(record, r.seq),
      title: r.title,
      line: `${r.unitName ?? "A unit"}: ${r.line}`,
      player: r.favours,
      units: r.unitId ? [r.unitId] : [],
      score: RANK.rare + Math.log10(1 / r.p),
    });

  // The biggest swing against the odds, either way.
  const swing = [...stats.runs]
    .filter((r) => r.measure === "slain")
    .sort((a, b) => Math.abs(b.actual - b.expected) - Math.abs(a.actual - a.expected))[0];
  if (swing) {
    const diff = swing.actual - swing.expected;
    const big = Math.abs(diff) >= 3 || (swing.expected >= 2 && Math.abs(diff) / swing.expected >= 0.5);
    if (big) {
      const attacker = swing.title.split(" at ")[0];
      const target = swing.title.split(" at ")[1] ?? "the enemy";
      const other = stats.players.find((p) => p.id !== swing.player)?.id;
      out.push(
        through({
          kind: "swing",
          seq: swing.seq,
          end: swing.seq,
          round: swing.round,
          when: whenAt(record, swing.seq),
          // "Not a scratch" only when nothing was lost; fewer than feared is shrugging it off (PX share 2).
          title:
            diff > 0
              ? "The volley that broke them"
              : swing.actual === 0
                ? "Not a scratch"
                : "Shrugged it off",
          line:
            diff > 0
              ? `${attacker} killed ${swing.actual} ${target} (about ${Math.round(swing.expected)} expected)`
              : swing.actual === 0
                ? `${target} shrugged off ${attacker}, losing none (about ${Math.round(swing.expected)} expected)`
                : `${target} shrugged off ${attacker}, losing ${swing.actual} (about ${Math.round(swing.expected)} expected)`,
          player: diff > 0 ? swing.player : other,
          units: [],
          score: RANK.swing + Math.abs(diff),
        }),
      );
    }
  }

  // The turning point: the round with the biggest gap in points destroyed.
  if (stats.players.length === 2) {
    const [a, b] = stats.players as [(typeof stats.players)[0], (typeof stats.players)[0]];
    let best = -1;
    let gap = 0;
    for (let i = 0; i < stats.rounds; i++) {
      const g = Math.abs((a.pointsByRound[i] ?? 0) - (b.pointsByRound[i] ?? 0));
      if (g > gap) [gap, best] = [g, i];
    }
    if (best >= 0 && gap >= 100) {
      const pa = Math.round(a.pointsByRound[best] ?? 0);
      const pb = Math.round(b.pointsByRound[best] ?? 0);
      const seq = firstSeqOfRound(record, best + 1);
      out.push({
        kind: "turning",
        seq,
        end: seq,
        round: best + 1,
        when: `Round ${best + 1}`,
        title: "The turning point",
        line: `Round ${best + 1}: ${a.name} destroyed ${pa} pts, ${b.name} ${pb}`,
        player: pa >= pb ? a.id : b.id,
        units: [],
        score: RANK.turning + gap / 50,
      });
    }
  }

  // Each player's most valuable unit: the most enemy points destroyed.
  for (const p of stats.players) {
    const best = Object.entries(killed)
      .filter(([u]) => state.units[u]?.owner === p.id)
      .sort((x, y) => y[1].pts - x[1].pts || y[1].units.size - x[1].units.size)[0];
    if (!best || (!best[1].pts && !best[1].units.size)) continue;
    const [unit, k] = best;
    out.push({
      kind: "mvp",
      seq: k.seq,
      end: k.seq,
      round: Math.max(1, state.turn.round),
      when: "The whole game",
      // "You's" reads wrong against the computer, where your side is called You (dogfood round 2).
      title: p.name === "You" ? "Your most valuable unit" : `${p.name}'s most valuable unit`,
      line: `${nameOf(state, unit)} destroyed ${[
        ...(k.units.size ? [`${k.units.size} unit${k.units.size === 1 ? "" : "s"}`] : []),
        ...(k.pts ? [`${Math.round(k.pts)} pts`] : []),
      ].join(", ")}`,
      player: p.id,
      units: [unit],
      score: k.pts,
    });
  }
  return out.sort((x, y) => x.seq - y.seq);
}

function lastStanding(
  state: GameState,
  unit: UnitId,
  lone: { seq: number; round: number; survived: number },
  endRound: number,
  /** Still standing when the game ended. */
  end: boolean,
): Moment {
  const rounds = Math.max(1, endRound - lone.round + 1);
  const owner = state.units[unit]?.owner;
  const attacks = lone.survived ? ` through ${lone.survived} attack${lone.survived === 1 ? "" : "s"}` : "";
  const time = rounds > 1 ? ` for ${rounds} rounds` : "";
  return {
    kind: "last",
    seq: lone.seq,
    end: lone.seq,
    round: lone.round,
    when: `Round ${lone.round}`,
    title: "Last one standing",
    line: `The last of ${nameOf(state, unit)} held on alone${attacks}${time}${end ? " to the end" : ""}`,
    player: owner,
    units: [unit],
    score: RANK.last + lone.survived + rounds,
  };
}

function whenAt(record: GameRecord, seq: number): string {
  let state = record.initial;
  const undone = undoneSeqs(record, seq);
  for (const e of record.events) {
    if (e.seq > seq) break;
    if (!undone.has(e.seq)) state = applyEvent(state, e.event);
  }
  const phase = phaseName(state);
  return `Round ${Math.max(1, state.turn.round)}${phase ? ` · ${phase}` : ""}`;
}

function firstSeqOfRound(record: GameRecord, round: number): number {
  let state = record.initial;
  for (const e of record.events) {
    state = applyEvent(state, e.event);
    if (state.turn.round >= round) return e.seq;
  }
  return record.events.at(-1)?.seq ?? 0;
}

/**
 * The reel: up to 5 moments, one per event, at most 2 of a kind, each player at least one
 * when they have any, in game order; then one most-valuable-unit card per
 * player to close it.
 */
export function momentsOf(record: GameRecord): Moment[] {
  const cached = memo.get(record);
  if (cached) return cached;
  const all = momentCandidates(record);
  const pool = all.filter((m) => m.kind !== "mvp").sort((a, b) => b.score - a.score);
  const picked: Moment[] = [];
  const count = (k: MomentKind) => picked.filter((m) => m.kind === k).length;
  const take = (m: Moment) => {
    // One card per moment: a wipe that was also a swing is told once, by the bigger story.
    if (picked.length < 5 && !picked.some((p) => p.seq === m.seq) && count(m.kind) < 2) picked.push(m);
  };
  // Each player's best first, then the biggest of the rest.
  const players = [...new Set(pool.flatMap((m) => (m.player ? [m.player] : [])))];
  for (const p of players) {
    const best = pool.find((m) => m.player === p);
    if (best) take(best);
  }
  for (const m of pool) take(m);
  const reel = [...picked.sort((a, b) => a.seq - b.seq), ...all.filter((m) => m.kind === "mvp")];
  memo.set(record, reel);
  return reel;
}
const memo = new WeakMap<GameRecord, Moment[]>();
