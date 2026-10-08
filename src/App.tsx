import { lazy, Suspense, useEffect } from "react";
import { t } from "./i18n";
import { loadTrystero, useStore } from "./store";
import { CrashGuard } from "./ui/Crash";
import { SavedToast } from "./ui/SavedNote";
import { Lobby } from "./ui/Lobby";
import { useLibraryOpen } from "./figures/open";

/**
 * The 3D table, three.js and every in-game panel load as their own chunk,
 * after the front door: the lobby is on screen and clickable while they come
 * (perf/budget.md, load). An idle prefetch means they're usually here before
 * anyone clicks.
 */
const loadGame = () => import("./GameScreen");
const GameScreen = lazy(() => loadGame().then((m) => ({ default: m.GameScreen })));
/** The figure library (#33) loads when it's first opened. */
const FigureLibrary = lazy(() =>
  import("./figures/FigureLibrary").then((m) => ({ default: m.FigureLibrary })),
);

export function App() {
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  const library = useLibraryOpen((s) => s.tab !== null);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => {
      void loadGame();
      void loadTrystero();
    });
  }, []);
  return (
    <>
      <CrashGuard>
        <Suspense
          fallback={started ? <div className="loading-table">{t("Setting up the table…")}</div> : null}
        >
          <GameScreen started={started} />
        </Suspense>
      </CrashGuard>
      {!started && <Lobby />}
      {/* A new version only between games, never mid-battle (#34). */}
      <SavedToast />
      {library && (
        <Suspense fallback={null}>
          <FigureLibrary />
        </Suspense>
      )}
    </>
  );
}
