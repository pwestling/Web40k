import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { aliveModels, moveAllowance, unitMoved } from "../systems/wh40k/rules";
import { distanceText } from "./distance";
import { buildLog, type LogItem } from "./gameLog";
import { useHold } from "./hold";

/** How long after the last arrow-key nudge a unit's move is read out. */
const SETTLE_MS = 900;

const spoken = (item: LogItem) =>
  item.kind === "line" && item.detail?.length ? `${item.text}: ${item.detail.join(", ")}` : item.text;

/** "4.0" left" after a nudged unit's move, when its move has a limit this phase. */
function left(unitId: string): string {
  const game = useStore.getState().game;
  const unit = game.units[unitId];
  if (!unit || !game.turn.round) return "";
  const allowed = moveAllowance(game, unit);
  if (allowed === null) return "";
  const rest = allowed - unitMoved(aliveModels(game, unit));
  return rest < -0.05
    ? `, ${distanceText(game, -rest)} too far`
    : `, ${distanceText(game, Math.max(0, rest))} left`;
}

/**
 * Screen readers hear the game as it happens (#25): each new log line
 * (moves, dice and their results, phase changes) is read out politely, after
 * the dice tray has shown the roll, the same moment the log shows it. A line
 * that changes (an attack as it's rolled) is read again (UX 179); a unit
 * nudged with the arrow keys is read once the player stops, with what's left
 * of its move (UX 180).
 */
export function Announcer() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const held = useHold((s) => s.held);
  const upto = held !== null ? held - 1 : Infinity;
  const log = useMemo(() => buildLog(record, upto), [record, upto]);
  const said = useRef<Map<string, string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The same words twice in a row are still news: alternate a trailing space so the region changes.
  const [text, setText] = useState({ words: "", odd: false });
  useEffect(() => {
    // What was already on the table when this screen opened isn't news.
    if (said.current === null) {
      said.current = new Map(log.map((item) => [item.key, spoken(item)]));
      return;
    }
    if (scrub !== null) return;
    const fresh = log.filter((item) => item.text && said.current!.get(item.key) !== spoken(item));
    for (const item of fresh) said.current.set(item.key, spoken(item));
    if (!fresh.length) return;
    clearTimeout(timer.current);
    const say = (words: string) => setText((t) => ({ words, odd: !t.odd }));
    const last = fresh.at(-1)!;
    const words = fresh.slice(-4).map(spoken).join(". ");
    if (last.kind === "line" && last.settle) {
      const unitId = last.settle.unitId;
      timer.current = setTimeout(() => say(`${words}${left(unitId)}`), SETTLE_MS);
    } else say(words);
  }, [log, scrub]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="sr-only" role="log" aria-live="polite" aria-atomic="true">
      {text.words}
      {text.odd ? " " : ""}
    </div>
  );
}
