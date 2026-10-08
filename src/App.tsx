import { lazy, Suspense, useEffect } from "react";
import { loadTrystero, useStore } from "./store";
import { Lobby } from "./ui/Lobby";

/**
 * The 3D table, three.js and every in-game panel load as their own chunk,
 * after the front door: the lobby is on screen and clickable while they come
 * (perf/budget.md, load). An idle prefetch means they're usually here before
 * anyone clicks.
 */
const loadGame = () => import("./GameScreen");
const GameScreen = lazy(() => loadGame().then((m) => ({ default: m.GameScreen })));

export function App() {
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => {
      void loadGame();
      void loadTrystero();
    });
  }, []);
  return (
    <>
      <Suspense fallback={started ? <div className="loading-table">Setting up the table…</div> : null}>
        <GameScreen started={started} />
      </Suspense>
      {!started && <Lobby />}
    </>
  );
}
