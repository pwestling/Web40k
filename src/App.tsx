import { Board } from "./render/Board";
import { useStore } from "./store";
import { Hud, Lobby } from "./ui/Hud";

export function App() {
  const started = useStore((s) => s.session !== null);
  return (
    <>
      <Board />
      {started ? <Hud /> : <Lobby />}
    </>
  );
}
