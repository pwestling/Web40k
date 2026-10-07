import { useStore } from "../store";
import { useGame } from "./hooks";

/** Rule options for this game. Set during deployment; shown read-only once the battle starts. */
export function GameSettings() {
  const game = useGame();
  const { dispatch, role, scrub } = useStore();
  const { cover, modelsBlock } = game.settings;
  const los = game.settings.los ?? "true";
  const editable = game.turn.round === 0 && role !== "spectator" && scrub === null;
  return (
    <details className="settings">
      <summary>Game settings</summary>
      {editable ? (
        <>
          <label>
            Cover{" "}
            <select
              value={cover}
              onChange={(e) =>
                dispatch({ type: "settings/set", settings: { cover: e.target.value as "hit" | "save" } })
              }
            >
              <option value="hit">−1 to hit</option>
              <option value="save">+1 to save</option>
            </select>
          </label>
          <label>
            Line of sight{" "}
            <select
              value={los}
              onChange={(e) =>
                dispatch({ type: "settings/set", settings: { los: e.target.value as "true" | "heights" } })
              }
            >
              <option value="true">True line of sight</option>
              <option value="heights">Stand-in heights</option>
            </select>
          </label>
          {los === "heights" && (
            <p className="muted small">
              Each terrain piece counts as a block of its stand-in height, and models see each other if the
              line between their tops clears it. Set heights in the terrain editor; X-ray shows them.
            </p>
          )}
          <label>
            Models see{" "}
            <select
              value={game.settings.visionArc ?? 360}
              // 360 rather than "missing", so the change survives being sent to peers as JSON.
              onChange={(e) =>
                dispatch({ type: "settings/set", settings: { visionArc: Number(e.target.value) } })
              }
            >
              <option value={360}>All around</option>
              <option value={180}>In a 180° front arc</option>
              <option value={90}>In a 90° front arc</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={modelsBlock}
              onChange={(e) =>
                dispatch({ type: "settings/set", settings: { modelsBlock: e.target.checked } })
              }
            />
            Other units' models block line of sight
          </label>
        </>
      ) : (
        <p className="muted small">
          {los === "heights" ? "Stand-in heights" : "True"} line of sight. Cover:{" "}
          {cover === "hit" ? "−1 to hit" : "+1 to save"}.{" "}
          {game.settings.visionArc && game.settings.visionArc < 360
            ? `Models see in a ${game.settings.visionArc}° front arc. `
            : ""}
          Other units' models {modelsBlock ? "block" : "don't block"} line of sight.
        </p>
      )}
    </details>
  );
}
