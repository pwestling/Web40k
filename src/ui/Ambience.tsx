import { useEffect, useRef } from "react";
import { BROADCAST, delaying } from "../broadcast/broadcast";
import { useStore } from "../store";
import { ambience } from "./roomTone";
import { useGame } from "./hooks";
import { drum, turnBell, useSound } from "./sound";

const TITLE = "Open Battle";

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
    if (turn.round > was.round && turn.round > 1) drum(2);
    else if (turn.round === was.round && turn.activeSeat !== was.seat && turn.round > 0) turnBell();
    else return;
    // Your turn while you're in another tab: say so in the tab title.
    const s = useStore.getState();
    const me = s.session ? s.game.players[s.session.selfId] : undefined;
    if (document.hidden && s.mode !== "hotseat" && me?.seat === turn.activeSeat)
      document.title = `● Your turn · ${TITLE}`;
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
