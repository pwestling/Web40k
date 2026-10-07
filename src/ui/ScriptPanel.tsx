import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";

/**
 * A rule written as code waiting on a player (core/script.ts): its question
 * and the options, answered by the player it asks. Everyone sees what it waits on.
 */
export function ScriptPanel() {
  const game = useGame();
  const { dispatch, scrub } = useStore();
  const canControl = useCanControl();
  const waiting = game.script?.waiting;
  if (!waiting || scrub !== null) return null;
  const mine = canControl(waiting.player);
  const who = game.players[waiting.player]?.name ?? "A player";
  return (
    <div className="panel script">
      {/* The question leads with who decides (UX 90), and says so when it isn't you. */}
      <div className="label">
        <strong>{who}:</strong> {waiting.question}
        {!mine && <span className="muted"> (waiting for {who})</span>}
      </div>
      <div className="chips">
        {waiting.options.map((o) => (
          <button
            key={o.id}
            disabled={!mine}
            onClick={() => dispatch({ type: "script/answer", answer: o.id }, waiting.player)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
