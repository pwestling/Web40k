import { useEffect } from "react";
import { Board } from "./render/Board";
import { useStore } from "./store";
import { AttackPanel } from "./ui/AttackPanel";
import { Hud } from "./ui/Hud";
import { Lobby } from "./ui/Lobby";
import { ReplayBar } from "./ui/ReplayBar";
import { removeTerrain, rotateTerrain, TerrainPanel } from "./ui/TerrainPanel";
import { TopBar } from "./ui/TopBar";
import { climbUnit, rotateUnit, UnitCard } from "./ui/UnitCard";

/**
 * Keyboard: Esc clears; Q/E rotate; R/F move a unit up or down a floor;
 * Delete removes the selected terrain piece while editing; Home resets the camera.
 */
function onKey(e: KeyboardEvent) {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)
    return;
  const s = useStore.getState();
  const key = e.key.toLowerCase();
  if (key === "home") {
    s.resetView();
    return;
  }
  if (key === "escape") {
    if (s.view === "eye") s.setView("3d");
    s.setDraft(null);
    s.select(null);
    s.set({ selectedTerrain: null, losFrom: null });
    return;
  }
  if (s.role === "spectator" || s.scrub !== null) return;
  if (s.editing && s.selectedTerrain) {
    if (key === "q") rotateTerrain(s.selectedTerrain, -15);
    if (key === "e") rotateTerrain(s.selectedTerrain, 15);
    if (key === "delete" || key === "backspace") removeTerrain(s.selectedTerrain);
    return;
  }
  const unit = s.selected ? s.game.units[s.selected] : undefined;
  if (!unit || (s.mode !== "hotseat" && unit.owner !== s.session?.selfId)) return;
  if (key === "q") rotateUnit(unit.id, -1);
  if (key === "e") rotateUnit(unit.id, 1);
  if (key === "r") climbUnit(unit.id, 1);
  if (key === "f") climbUnit(unit.id, -1);
}

export function App() {
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  const editing = useStore((s) => s.editing);
  // The attack flow takes the unit card's place on the right, keeping the table clear.
  const attacking = useStore((s) => s.game.attack !== null || (s.draft !== null && s.scrub === null));
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  useEffect(() => {
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <Board />
      {started ? (
        <>
          <TopBar />
          <Hud />
          {editing ? <TerrainPanel /> : attacking ? <AttackPanel /> : <UnitCard />}
          <ReplayBar />
          {view === "eye" && (
            <button className="eye-exit primary" onClick={() => setView("3d")}>
              Leave model's eye view (Esc)
            </button>
          )}
        </>
      ) : (
        <Lobby />
      )}
    </>
  );
}
