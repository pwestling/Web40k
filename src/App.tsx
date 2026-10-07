import { useEffect } from "react";
import { Board } from "./render/Board";
import { useStore } from "./store";
import { AttackPanel } from "./ui/AttackPanel";
import { Hud } from "./ui/Hud";
import { Lobby } from "./ui/Lobby";
import { ReplayBar } from "./ui/ReplayBar";
import { TopBar } from "./ui/TopBar";
import { rotateUnit, UnitCard } from "./ui/UnitCard";

export function App() {
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const { selected, game, mode, session, role, scrub, setDraft, select } = useStore.getState();
      if (e.key === "Escape") {
        setDraft(null);
        select(null);
      }
      const unit = selected ? game.units[selected] : undefined;
      if (!unit || role === "spectator" || scrub !== null) return;
      if (mode !== "hotseat" && unit.owner !== session?.selfId) return;
      if (e.key === "q" || e.key === "Q") rotateUnit(unit.id, -1);
      if (e.key === "e" || e.key === "E") rotateUnit(unit.id, 1);
    };
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
          <UnitCard />
          <AttackPanel />
          <ReplayBar />
        </>
      ) : (
        <Lobby />
      )}
    </>
  );
}
