import { create } from "zustand";
import type { GameState } from "../core";
import type { Session } from "../net/session";
import { useStore } from "../store";
import { t } from "../i18n";
import type { Level } from "./player";
import type { Policy } from "./policy";

/**
 * Solo against the computer (#45): which side the computer plays in this
 * game, and how well. Tied to the game's session, so opening another game
 * ends it. The computer's own memory (its policy) lives here too.
 */
export interface Solo {
  level: Level | null;
  /** The computer's side. */
  seat: number;
  session: Session | null;
  policy: Policy | null;
  seed: number;
  /** Paused from the ⋯ menu (UX 347): the computer waits and its side is yours to move. */
  paused: boolean;
  /** Why the computer made its last move, shown in the hint (UX 352). */
  why: string | null;
}

export const useSolo = create<Solo>(() => ({
  level: null,
  seat: 1,
  session: null,
  policy: null,
  seed: 1,
  paused: false,
  why: null,
}));

/** The computer's moves glide, slow enough to follow (PX solo review 2). */
export const GLIDE_MS = 900;

export const LEVEL_KEY = "open-battle:bot-level";

/** The level picked last time on this device (Easy if none). */
export function savedLevel(): Level {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    // Easy the first time (UX 350), then whatever was picked last.
    return v === "steady" || v === "sharp" ? v : "random";
  } catch {
    return "random";
  }
}

/** The computer plays the game just started (this screen's session), on the other side. */
export function armSolo(level: Level, seat = 1): void {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // Remembering the level is a nicety.
  }
  useSolo.setState({
    level,
    seat,
    session: useStore.getState().session,
    policy: null,
    seed: Date.now() % 2 ** 31,
    paused: false,
    why: null,
  });
  // The camera follows the action, the computer's included (UX 348).
  useStore.setState({ director: true });
}

export function endSolo(): void {
  useSolo.setState({ level: null, session: null, policy: null, paused: false, why: null });
}

/** Whether the computer plays this player in the game on screen. */
export function soloPlays(game: GameState, player: string | undefined): boolean {
  const { level, seat, session } = useSolo.getState();
  if (!level || useSolo.getState().paused || !player || session !== useStore.getState().session) return false;
  return game.players[player]?.seat === seat;
}

/** Who the computer is at each level (PX solo review 4): someone to lose to, not something. */
export function characterName(level: Level): string {
  return level === "random"
    ? t("Rook the Novice")
    : level === "sharp"
      ? t("The Iron Tactician")
      : t("The Warden of Ash");
}

/** A level's name, as the lobby offers it. */
export function levelName(level: Level): string {
  return level === "random" ? t("Easy") : level === "sharp" ? t("Sharp") : t("Steady");
}
