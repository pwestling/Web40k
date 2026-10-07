import { useEffect, useState } from "react";
import { useStore } from "../store";

/** Scrub through the game log. Works live (to look back) and on loaded replays. */
export function ReplayBar() {
  const { record, scrub, setScrub, session } = useStore();
  const [playing, setPlaying] = useState(false);
  const last = record.events.at(-1)?.seq ?? 0;
  const pos = scrub ?? last;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const s = useStore.getState();
      const at = s.scrub ?? last;
      if (at >= last) {
        setPlaying(false);
        if (s.session) s.setScrub(null);
      } else s.setScrub(at + 1);
    }, 400);
    return () => clearInterval(t);
  }, [playing, last]);

  return (
    <div className="replaybar">
      <button onClick={() => setPlaying(!playing)}>{playing ? "⏸" : "▶"}</button>
      <input
        type="range"
        min={0}
        max={last}
        value={pos}
        onChange={(e) => {
          const v = Number(e.target.value);
          setScrub(v >= last && session ? null : v);
        }}
      />
      <span className="muted">
        {pos}/{last}
      </span>
      {scrub !== null && session && <button onClick={() => setScrub(null)}>Back to live</button>}
      {!session && <button onClick={() => location.reload()}>Close replay</button>}
    </div>
  );
}
