import { useStore } from "../store";
import { useGame } from "./hooks";

/** Rule options for this game. Set during deployment; shown read-only once the battle starts. */
export function GameSettings() {
  const game = useGame();
  const { dispatch, role, scrub } = useStore();
  const { cover, modelsBlock } = game.settings;
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
          Cover: {cover === "hit" ? "−1 to hit" : "+1 to save"}. Other units' models{" "}
          {modelsBlock ? "block" : "don't block"} line of sight.
        </p>
      )}
    </details>
  );
}
