import { useEffect, useState } from "react";
import { t } from "../i18n";
import { setRollsMine, useSolo } from "./solo";

/**
 * The player's own roll in the computer's turn (UX 404): how long before the computer rolls it for
 * them, or null when it isn't waiting on them.
 */
function useLeftMs(): number | null {
  const deadline = useSolo((s) => s.deadline);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - now);
}

/** "(rolls itself in 8…)" and a ring that empties, inside the roll button. */
export function SelfRollCountdown() {
  const deadline = useSolo((s) => s.deadline);
  const wait = useSolo((s) => s.wait);
  const ms = useLeftMs();
  if (ms === null || deadline === null) return null;
  const left = Math.max(1, Math.ceil(Math.min(ms, wait) / 1000));
  return (
    <>
      {" "}
      <span className="self-roll-note">{t("(rolls itself in {n}…)", { n: left })}</span>
      <span
        key={deadline}
        className="self-roll-ring"
        aria-hidden
        style={{ animationDuration: `${wait}ms` }}
      />
    </>
  );
}

/** The solo setting, next to the roll it changes. */
export function RollsMineToggle() {
  const on = useSolo((s) => s.rollsMine);
  return (
    <label className="rolls-mine small muted">
      <input type="checkbox" checked={on} onChange={(e) => setRollsMine(e.target.checked)} />{" "}
      {t("Roll my saves for me")}
    </label>
  );
}
