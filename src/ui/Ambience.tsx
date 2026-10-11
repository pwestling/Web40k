import { useEffect, useRef } from "react";
import { BROADCAST, delaying } from "../broadcast/broadcast";
import { useStore } from "../store";
import { ambience } from "./roomTone";
import { useGame } from "./hooks";
import { create } from "zustand";
import { drum, turnBell, turnKnock, useSound } from "./sound";

const TITLE = "Open Battle";

/** How many times the turn came to this screen's player (PX B3): their top-bar card flashes "Your turn" once. */
export const useYourTurn = create<{ at: number; on: boolean }>(() => ({ at: 0, on: false }));
let flashOff: ReturnType<typeof setTimeout> | undefined;

/**
 * The room (PX-5c): room tone while the table is open, a bell when the turn
 * passes, a low double drum at each new round, and the tab title flashing
 * when it becomes your turn while you're in another tab.
 */
export function Ambience() {
  const sound = useSound((s) => s.on && s.ambience);
  // Room tone: not on the stream view, whose audio is the commentator's.
  useEffect(() => {
    const want = !BROADCAST;
    const sync = () => ambience(want);
    sync();
    // Audio only starts after the first click, so keep trying until it does.
    const t = setInterval(sync, 2000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", sync);
      ambience(false);
    };
  }, [sound]);

  // The turn as this screen shows it (the dice settled, a delayed viewer's table).
  const turn = useGame().turn;
  const scrub = useStore((s) => s.scrub);
  const last = useRef<{ round: number; seat: number } | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = { round: turn.round, seat: turn.activeSeat };
    // Live (or the delay running behind), never while scrubbing or replaying a moment.
    if (!was || (scrub !== null && !delaying())) return;
    const s = useStore.getState();
    const me = s.session ? s.game.players[s.session.selfId] : undefined;
    // The turn passing to you, on your screen only: a knock and your card flashing (PX B3).
    const yours =
      s.mode !== "hotseat" && s.role !== "spectator" && me?.seat === turn.activeSeat && turn.round > 0;
    if (turn.round > was.round && turn.round > 1) drum(2);
    else if (turn.round === was.round && turn.activeSeat !== was.seat && turn.round > 0)
      (yours ? turnKnock : turnBell)();
    else return;
    if (yours && scrub === null) {
      useYourTurn.setState((y) => ({ at: y.at + 1, on: true }));
      clearTimeout(flashOff);
      flashOff = setTimeout(() => useYourTurn.setState({ on: false }), 2600);
    }
    // Your turn while you're in another tab: say so in the tab title.
    if (document.hidden && yours) document.title = `● Your turn · ${TITLE}`;
  }, [turn.round, turn.activeSeat, scrub]);

  useEffect(() => {
    const back = () => {
      if (!document.hidden && document.title !== TITLE && document.title.endsWith(TITLE))
        document.title = TITLE;
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  return null;
}
