import { Board } from "./render/Board";
import { useStore } from "./store";
import { AttackPanel } from "./ui/AttackPanel";
import { Hud } from "./ui/Hud";
import { Lobby } from "./ui/Lobby";
import { ReplayBar } from "./ui/ReplayBar";
import { TopBar } from "./ui/TopBar";
import { UnitCard } from "./ui/UnitCard";

export function App() {
  const started = useStore((s) => s.session !== null || s.role === "spectator");
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
