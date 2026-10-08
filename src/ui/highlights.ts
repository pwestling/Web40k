import { applyEvent, systemOf, undoneSeqs, type GameRecord, type GameState } from "../core";
import { aliveModels, ENGAGEMENT_RANGE, unitDistance } from "../systems/wh40k/rules";
import { opposed } from "../core/teams";
import { t } from "../i18n";

/** A moment worth jumping to in a replay. */
export interface Highlight {
  seq: number;
  kind: "wiped" | "charge" | "swing";
  text: string;
}

/** How a round went for one player. */
export interface RoundPlayer {
  id: string;
  name: string;
  color: string;
  vp: number;
  vpGained: number;
  modelsLost: number;
  unitsLost: string[];
}

/** The summary card shown when a round ends. `seq` is the event that ended it. */
export interface RoundSummary {
  seq: number;
  round: number;
  players: RoundPlayer[];
}

/** A VP change this big, in one go or within one phase, counts as a swing. */
const SWING = 3;
const isVp = (resource: string) => /^vp$|victory/i.test(resource);

/**
 * Fold the game once and pick out its highlights (a unit wiped out, a failed
 * charge, a big swing in victory points) and a summary of every finished
 * round. Works from the event log alone, so it serves live games and replays.
 */
export function readGame(
  record: GameRecord,
  uptoSeq = Infinity,
): { highlights: Highlight[]; rounds: RoundSummary[] } {
  const undone = undoneSeqs(record, uptoSeq);
  const highlights: Highlight[] = [];
  const rounds: RoundSummary[] = [];
  let state = record.initial;
  let roundStart: GameState | null = null;
  let phaseKey = "";
  let phaseVp: Record<string, number> = {};
  const name = (s: GameState, id: string) => s.players[id]?.name ?? t("Someone");

  const summarise = (end: GameState, seq: number, round: number) => {
    const start = roundStart ?? end;
    rounds.push({
      seq,
      round,
      players: Object.values(end.players)
        .filter((p) => p.seat !== undefined)
        .sort((a, b) => a.seat! - b.seat!)
        .map((p) => {
          const vp = vpOf(end, p.id);
          const lost = Object.values(end.models).filter(
            (m) => m.owner === p.id && m.destroyed && !start.models[m.id]?.destroyed,
          ).length;
          const unitsLost = Object.values(end.units)
            .filter(
              (u) =>
                u.owner === p.id &&
                !aliveModels(end, u).length &&
                start.units[u.id] &&
                aliveModels(start, u).length,
            )
            .map((u) => u.name);
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            vp,
            vpGained: vp - vpOf(start, p.id),
            modelsLost: lost,
            unitsLost,
          };
        }),
    });
  };

  for (const logged of record.events) {
    if (logged.seq > uptoSeq) break;
    const before = state;
    if (!undone.has(logged.seq)) state = applyEvent(state, logged.event);
    state = { ...state, seq: logged.seq };
    if (undone.has(logged.seq)) continue;
    const { event, seq } = logged;

    // Rounds: a summary when the round number goes up (or the battle ends).
    if (before.turn.round > 0 && state.turn.round > before.turn.round)
      summarise(state, seq, before.turn.round);
    if (before.turn.round === 0 && state.turn.round > 0) roundStart = state;
    else if (state.turn.round > before.turn.round) roundStart = state;

    // Units wiped out by this event.
    for (const u of Object.values(state.units)) {
      const was = before.units[u.id];
      if (was && aliveModels(before, was).length && !aliveModels(state, u).length && u.modelIds.length)
        highlights.push({ seq, kind: "wiped", text: t("{unit} wiped out", { unit: u.name }) });
    }

    // A charge roll short of the nearest enemy.
    if (event.type === "dice/roll" && /charge/i.test(event.roll.label ?? "") && event.roll.unitId) {
      const unit = state.units[event.roll.unitId];
      const total = event.roll.results.reduce((a, b) => a + b, 0);
      if (unit) {
        const mine = aliveModels(state, unit);
        const gap = Math.min(
          Infinity,
          ...Object.values(state.units)
            .filter((u) => opposed(state, u.owner, unit.owner))
            .map((u) => aliveModels(state, u))
            .filter((ms) => ms.length)
            .map((ms) => unitDistance(mine, ms)),
        );
        if (Number.isFinite(gap) && total < gap - ENGAGEMENT_RANGE)
          highlights.push({
            seq,
            kind: "charge",
            text: t('{unit} failed a charge ({total}")', { unit: unit.name, total }),
          });
      }
    }

    // Big VP swings: one adjustment, or the total within a phase.
    const key = `${state.turn.round}/${state.turn.activeSeat}/${state.turn.phase}`;
    if (key !== phaseKey) {
      phaseKey = key;
      phaseVp = {};
    }
    if (event.type === "resource/adjust" && isVp(event.resource)) {
      const total = (phaseVp[event.player] ?? 0) + event.delta;
      const crossed = Math.abs(total) >= SWING && Math.abs(phaseVp[event.player] ?? 0) < SWING;
      phaseVp[event.player] = total;
      if (crossed)
        highlights.push({
          seq,
          kind: "swing",
          text: t("{name} {change} VP", {
            name: name(state, event.player),
            change: `${total > 0 ? "+" : ""}${total}`,
          }),
        });
    }
  }
  return { highlights, rounds };
}

function vpOf(state: GameState, player: string): number {
  const own = state.resources[player] ?? {};
  return Object.entries(own)
    .filter(([k]) => isVp(k))
    .reduce((a, [, v]) => a + (v ?? 0), 0);
}

/** What a replay's title card says, and where the battle starts. */
export interface ReplayIntro {
  /** Seq of the event that started round 1 (0 when the battle never started). */
  startSeq: number;
  players: { name: string; color: string }[];
  system: string;
  rounds: number;
  modelsLost: number;
}

export function replayIntro(record: GameRecord): ReplayIntro {
  const undone = undoneSeqs(record);
  let state = record.initial;
  // A branched game (core/branch.ts) may start mid-battle: watch from its first event.
  let startSeq = record.initial.turn.round > 0 ? record.initial.seq : 0;
  for (const logged of record.events) {
    if (undone.has(logged.seq)) continue;
    const before = state;
    state = applyEvent(state, logged.event);
    if (!startSeq && before.turn.round === 0 && state.turn.round > 0) startSeq = logged.seq;
  }
  const players = Object.values(state.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!)
    .map((p) => ({ name: p.name, color: p.color }));
  let system: string;
  let maxRounds = Infinity;
  try {
    const sys = systemOf(state);
    system = sys.name;
    if (typeof sys.turn.rounds === "number") maxRounds = sys.turn.rounds;
  } catch {
    system = state.system ?? "";
  }
  return {
    startSeq,
    players,
    system,
    // A finished game's round counter is one past the last round.
    rounds: Math.min(state.turn.round, maxRounds),
    modelsLost: Object.values(state.models).filter((m) => m.destroyed).length,
  };
}
