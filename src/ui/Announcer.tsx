import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { buildLog } from "./gameLog";
import { useHold } from "./hold";

/**
 * Screen readers hear the game as it happens (#25): each new log line
 * (moves, dice and their results, phase changes) is read out politely, after
 * the dice tray has shown the roll, the same moment the log shows it.
 */
export function Announcer() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const held = useHold((s) => s.held);
  const upto = held !== null ? held - 1 : Infinity;
  const log = useMemo(() => buildLog(record, upto), [record, upto]);
  const said = useRef<Set<string> | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const keys = log.map((item) => item.key);
    // What was already on the table when this screen opened isn't news.
    if (said.current === null) {
      said.current = new Set(keys);
      return;
    }
    if (scrub !== null) return;
    const fresh = log.filter((item) => !said.current!.has(item.key) && item.text);
    for (const item of fresh) said.current.add(item.key);
    if (fresh.length)
      setText(
        fresh
          .slice(-4)
          .map((item) =>
            item.kind === "line" && item.detail?.length
              ? `${item.text}: ${item.detail.join(", ")}`
              : item.text,
          )
          .join(". "),
      );
  }, [log, scrub]);
  return (
    <div className="sr-only" role="log" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
