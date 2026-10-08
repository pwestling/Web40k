import type { GameRecord } from "./log";
import { createRecord, stateAt } from "./log";
import { sha256Hex } from "./secrets";
import type { PlayerId } from "./types";

/**
 * "What if": a new game that starts from any point of another one's history
 * (a replay, or the live log), with the same system, packages, figures and
 * terrain. Its log opens with a `game/branch` event naming the parent: the
 * SHA-256 of the parent's record and the seq it branched at.
 */
export interface BranchInfo {
  /** SHA-256 of the parent record as JSON. */
  parentHash: string;
  /** The parent's event the branch starts after. */
  parentSeq: number;
  /** For the title card: "Player 1 vs Player 2, round 2". */
  title: string;
  /** The moment in words, e.g. "round 1, Shooting, just after Line Troopers shot Ashen Thralls". */
  moment?: string;
  round: number;
  /** Secrets that weren't carried over (they live on their owners' devices); players commit them again. */
  droppedSecrets: number;
  /** A rule written as code that was waiting on someone; it doesn't carry over. */
  droppedScript?: string;
}

export interface BranchEvent {
  type: "game/branch";
  branch: BranchInfo;
}

/** A new record starting at `seq` of `parent`. */
export function branchRecord(
  parent: GameRecord,
  seq: number,
  by: PlayerId = "",
  moment?: string,
): GameRecord {
  const at = Math.max(parent.initial.seq, Math.min(seq, parent.events.at(-1)?.seq ?? parent.initial.seq));
  const state = stateAt(parent, at);
  const players = Object.values(state.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!)
    .map((p) => p.name);
  const dropped = Object.values(state.secrets ?? {}).reduce(
    (n, mine) => n + Object.values(mine).filter((e) => !e.revealed).length,
    0,
  );
  const branch: BranchInfo = {
    parentHash: sha256Hex(JSON.stringify(parent)),
    parentSeq: at,
    title: `${players.join(" vs ")}${state.turn.round ? `, round ${state.turn.round}` : ", deployment"}`,
    round: state.turn.round,
    ...(moment ? { moment } : {}),
    droppedSecrets: dropped,
    ...(state.script ? { droppedScript: state.script.procedure } : {}),
  };
  // Secrets stay with their owners, and a half-run rule can't replay without the parent's log.
  const { secrets: _s, script: _c, packageProposal: _p, ...rest } = state;
  const record = createRecord({ ...rest, script: null });
  record.events.push({ seq: at + 1, by, at: Date.now(), event: { type: "game/branch", branch } });
  return record;
}
