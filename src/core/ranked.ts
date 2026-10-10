import { DEFAULT_SYSTEM, systemOf } from "./content/turn";
import type { GameState, PlayerId } from "./types";

/**
 * Ranked games (#65), the part every peer applies the same way. Both players
 * tie their player key (src/player) to their seat with `ranked/card`; when the
 * battle is over one of them writes the result into the log (`ranked/result`)
 * and each signs it (`ranked/sign`), or declines. Signatures are checked by the
 * clients (src/ranked), never here: the log only carries them.
 */

/** A player key as text: the P-256 public key's x and y (base64url), joined by a dot. */
export type PlayerKey = string;

export interface RankedPlayer {
  key: PlayerKey;
  name: string;
  vp: number;
}

/** What both players sign: who played what, the score, and the replay it came from. */
export interface RankedResult {
  v: 1;
  system: string;
  /** The game's size in points, when the system has one. */
  points: number | null;
  rounds: number;
  /** By seat: the first side, then the second. */
  players: [RankedPlayer, RankedPlayer];
  /** The seat that won, or null for a draw. */
  winner: 0 | 1 | null;
  /** SHA-256 (hex) of the game's events up to the result (core/ranked replayText). */
  replay: string;
  at: number;
  /** An online event's game (#67): the pairing this result settles. Part of what both sign. */
  event?: { id: string; round: number; table: number };
  /** The rules the game ran (docs/compatibility.md): ladders keep games with house rules apart. */
  rules?: RankedRules;
}

/** One rules package a ranked game ran. `game`: it is the game itself (a package with `kind: "system"`). */
export interface RankedPackage {
  id: string;
  name: string;
  version: string;
  hash: string;
  game?: true;
}

export interface RankedRules {
  /** The app build that set the game's packages, when it did: the reducer and built-in modules. */
  app?: string;
  /** Every rules package, sorted by id. */
  packages: RankedPackage[];
}

/**
 * Why a player didn't sign (PX ranked 1): the score is wrong (both fix it on
 * the table and the result is written again), the two agreed it wouldn't
 * count, or something went wrong at the table.
 */
export type DeclineWhy = "score" | "agreed" | "broke";

export const DECLINE_WHYS: readonly DeclineWhy[] = ["score", "agreed", "broke"];

/** A result can be written again this many times for a wrong score; then a decline is a decline. */
export const MAX_FIXES = 3;

export interface RankedState {
  /** Each opted-in player's key. */
  keys: Record<PlayerId, PlayerKey>;
  result?: RankedResult;
  /** Each player's signature on the result; null: they didn't sign it (disputed). */
  sigs: Record<PlayerId, string | null>;
  /** Why each player who didn't sign said so. */
  whys?: Record<PlayerId, DeclineWhy>;
  /** Each decliner's signature on their decline (src/ranked/verify.ts), so a refusal can't be made up. */
  declines?: Record<PlayerId, string>;
  /** Who said the score was wrong: the table fixes it before the result is written again. */
  fixing?: PlayerId;
  /** Results written again for a wrong score so far. */
  fixes?: number;
}

export const isPlayerKey = (k: unknown): k is PlayerKey =>
  typeof k === "string" && /^[A-Za-z0-9_-]{40,48}\.[A-Za-z0-9_-]{40,48}$/.test(k);

/** The battle has run past its last round. */
export function rankedOver(state: GameState): boolean {
  try {
    const rounds = systemOf(state).turn.rounds;
    return typeof rounds === "number" && state.turn.round > rounds;
  } catch {
    return false;
  }
}

/** The seated players, by seat: a ranked game has exactly two. */
export function rankedSeats(state: GameState): PlayerId[] {
  return Object.values(state.players)
    .filter((p) => typeof p.seat === "number" && p.seat >= 0)
    .sort((a, b) => a.seat! - b.seat!)
    .map((p) => p.id);
}

/** Both seated players opted in, one each side. */
export function rankedReady(state: GameState): boolean {
  const seats = rankedSeats(state);
  return (
    seats.length === 2 &&
    state.players[seats[0]!]!.seat !== state.players[seats[1]!]!.seat &&
    seats.every((p) => !!state.ranked?.keys[p]) &&
    state.ranked!.keys[seats[0]!] !== state.ranked!.keys[seats[1]!]
  );
}

/** The result as it stands: VP from the log's resources, the winner from them. */
export function rankedResultOf(state: GameState, replay: string, at: number): RankedResult | null {
  if (!rankedReady(state)) return null;
  const [a, b] = rankedSeats(state) as [PlayerId, PlayerId];
  const side = (p: PlayerId): RankedPlayer => ({
    key: state.ranked!.keys[p]!,
    name: state.players[p]!.name.slice(0, 32),
    vp: Math.max(0, Math.round(state.resources[p]?.VP ?? 0)),
  });
  const players: [RankedPlayer, RankedPlayer] = [side(a), side(b)];
  const rounds = Number(systemOf(state).turn.rounds) || 0;
  const rules: RankedRules = {
    ...(state.packages?.app ? { app: state.packages.app.slice(0, 80) } : {}),
    packages: (state.packages?.packages ?? [])
      .map((p, i) => ({
        id: p.id,
        name: p.name.slice(0, 60),
        version: p.version,
        hash: p.hash,
        // A package game names its package first (ui/Lobby namePackage), from before refs said so.
        ...(p.kind === "system" || (i === 0 && state.packages?.system.builtIn === false)
          ? { game: true as const }
          : {}),
      }))
      .sort(byId),
  };
  return {
    v: 1,
    system: state.system ?? DEFAULT_SYSTEM,
    points: typeof state.settings.points === "number" ? state.settings.points : null,
    rounds,
    players,
    winner: winnerOf(players),
    replay,
    at,
    ...(state.settings.event
      ? {
          event: {
            id: state.settings.event.id,
            round: state.settings.event.round,
            table: state.settings.event.table,
          },
        }
      : {}),
    rules,
  };
}

const byId = (a: RankedPackage, b: RankedPackage) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;

/** A result's rules in canonical form, null if they're malformed. */
function canonRules(raw: unknown): RankedRules | null {
  const r = raw as Partial<RankedRules> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.packages) || r.packages.length > 20) return null;
  if (r.app !== undefined && !(typeof r.app === "string" && r.app.length > 0 && r.app.length <= 80))
    return null;
  const packages: RankedPackage[] = [];
  for (const p of r.packages as Partial<RankedPackage>[]) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      p.id.length > 80 ||
      typeof p.name !== "string" ||
      p.name.length > 60 ||
      typeof p.version !== "string" ||
      p.version.length > 40 ||
      typeof p.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(p.hash) ||
      (p.game !== undefined && p.game !== true)
    )
      return null;
    packages.push({
      id: p.id,
      name: p.name,
      version: p.version,
      hash: p.hash,
      ...(p.game ? { game: true } : {}),
    });
  }
  return { ...(r.app ? { app: r.app } : {}), packages: packages.sort(byId) };
}

const winnerOf = (players: [RankedPlayer, RankedPlayer]): 0 | 1 | null =>
  players[0].vp === players[1].vp ? null : players[0].vp > players[1].vp ? 0 : 1;

/**
 * The result in one fixed spelling, for signing and checking: the same result
 * gives the same text whatever order its keys arrived in. Null if it isn't one.
 */
export function canonResult(raw: unknown): string | null {
  const r = raw as Partial<RankedResult> | null;
  if (!r || typeof r !== "object" || r.v !== 1) return null;
  if (typeof r.system !== "string" || !r.system || r.system.length > 80) return null;
  if (r.points !== null && !(Number.isInteger(r.points) && r.points! > 0 && r.points! < 100_000)) return null;
  if (!Number.isInteger(r.rounds) || r.rounds! < 0 || r.rounds! > 99) return null;
  if (!Array.isArray(r.players) || r.players.length !== 2) return null;
  const players = r.players.map((p) =>
    p &&
    isPlayerKey(p.key) &&
    typeof p.name === "string" &&
    p.name.length <= 32 &&
    Number.isInteger(p.vp) &&
    p.vp >= 0 &&
    p.vp < 10_000
      ? { key: p.key, name: p.name, vp: p.vp }
      : null,
  );
  if (!players[0] || !players[1] || players[0].key === players[1].key) return null;
  if (r.winner !== winnerOf(players as [RankedPlayer, RankedPlayer])) return null;
  if (typeof r.replay !== "string" || !/^[a-f0-9]{64}$/.test(r.replay)) return null;
  if (!Number.isFinite(r.at) || r.at! <= 0) return null;
  const e = r.event;
  if (
    e !== undefined &&
    !(
      e &&
      typeof e.id === "string" &&
      /^[a-z0-9]{8,40}$/.test(e.id) &&
      Number.isInteger(e.round) &&
      e.round >= 1 &&
      e.round <= 20 &&
      Number.isInteger(e.table) &&
      e.table >= 1 &&
      e.table <= 500
    )
  )
    return null;
  const rules = r.rules === undefined ? undefined : canonRules(r.rules);
  if (rules === null) return null;
  return JSON.stringify({
    v: 1,
    system: r.system,
    points: r.points,
    rounds: r.rounds,
    players,
    winner: r.winner,
    replay: r.replay,
    at: Math.round(r.at!),
    // Only when there is one, so results from before events sign the same.
    ...(e ? { event: { id: e.id, round: e.round, table: e.table } } : {}),
    // Likewise only when there are some, so results from before rulesets still verify.
    ...(rules ? { rules } : {}),
  });
}
