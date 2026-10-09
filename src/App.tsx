import { usePlayerOpen } from "./player/open";
import { lazy, Suspense, useEffect } from "react";
import { t } from "./i18n";
import { loadTrystero, useStore } from "./store";
import { CrashGuard } from "./ui/Crash";
import { SavedToast } from "./ui/SavedNote";
import { Lobby } from "./ui/Lobby";
import { useLibraryOpen } from "./figures/open";
import { useWorkshopOpen } from "./workshop/open";

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
/** The player card and ladder (#65) load when first opened. */
const PlayerDialog = lazy(() => import("./player/PlayerCard").then((m) => ({ default: m.PlayerDialog })));
/** The module workshop (#41) and its editor load when it's first opened. */
const Workshop = lazy(() => import("./workshop/Workshop").then((m) => ({ default: m.Workshop })));

export function App() {
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  const library = useLibraryOpen((s) => s.tab !== null);
  const workshop = useWorkshopOpen((s) => s.open);
  const player = usePlayerOpen((s) => s.view !== null);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => {
      // The game screen first, then the 3D table behind it.
      void loadGame().then((m) => m.loadBoard());
      void loadTrystero();
    });
  }, []);
  // Escape closes the top modal the way a click outside it does, for the ones without their own key (dogfood).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const top = [...document.querySelectorAll<HTMLElement>(".modal-backdrop")].at(-1);
      // After the modal's own handler, if it has one: still open means nobody closed it.
      if (top) setTimeout(() => top.isConnected && top.click(), 0);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
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
      {workshop && (
        <Suspense fallback={null}>
          <Workshop />
        </Suspense>
      )}
      {library && (
        <Suspense fallback={null}>
          <FigureLibrary />
        </Suspense>
      )}
      {player && (
        <Suspense fallback={null}>
          <PlayerDialog />
        </Suspense>
      )}
    </>
  );
}
