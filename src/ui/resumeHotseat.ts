import { useEffect } from "react";
import { useSolo } from "../bot/solo";
import type { Level } from "../bot/player";
import { useStore, type SavedGame } from "../store";
import { useCoach } from "../teach/store";

/**
 * A hotseat game survives a reload (UX 395): while one is on screen, this tab
 * notes it (sessionStorage: this tab only), and a reload goes straight back
 * into it from the saved game, the computer's side included. Going back to
 * the lobby, or a lesson, a mail game or a replay, clears the note.
 */
const KEY = "open-battle:hotseat";

interface Mark {
  /** The saved game's first event, so the note can't resume some other game. */
  at: number;
  solo: { level: Level; seat: number } | null;
}

/** Keep this tab's note of the hotseat game on screen. Mounted in the game screen. */
export function useHotseatMark(): void {
  const live = useStore(
    (s) => !!s.session && s.mode === "hotseat" && s.role === "host" && !s.review && !s.mail,
  );
  const lesson = useCoach((s) => !!s.lesson);
  const at = useStore((s) => s.record.events[0]?.at ?? 0);
  const level = useSolo((s) => (s.session && s.session === useStore.getState().session ? s.level : null));
  const seat = useSolo((s) => s.seat);
  useEffect(() => {
    try {
      if (live && !lesson && at)
        sessionStorage.setItem(KEY, JSON.stringify({ at, solo: level ? { level, seat } : null }));
      else sessionStorage.removeItem(KEY);
    } catch {
      // No session storage: a reload goes to the lobby, where Resume is.
    }
  }, [live, lesson, at, level, seat]);
  useEffect(
    () => () => {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // As above.
      }
    },
    [],
  );
}

/** After a reload, the hotseat game this tab was playing, and who the computer played, if any. */
export function reloadedInto(saved: SavedGame | null): Mark | null {
  if (!saved || saved.mode !== "hotseat") return null;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== "reload") return null;
  try {
    const mark = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Mark | null;
    return mark && mark.at === (saved.record.events[0]?.at ?? 0) ? mark : null;
  } catch {
    return null;
  }
}
