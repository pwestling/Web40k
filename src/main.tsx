import { useTouch } from "./render/touchState";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useAssets } from "./assets/store";
import * as core from "./core";
import { useStore } from "./store";
import "./styles.css";
import { loadSiteConfig } from "./net/config";
import { loadLanguage } from "./i18n";
import { watchFigures } from "./figures/library";
import { listenForInstall, registerServiceWorker } from "./sw/register";
import { watchErrors } from "./ui/report";
import { applyTextSize } from "./ui/textSize";
import { watchModals } from "./ui/modalInert";

// Recent errors go into a problem report (src/ui/report.ts).
watchErrors();
// The player's text size (#25).
applyTextSize();
// The page behind an open modal is inert (UX 472).
watchModals();
// Models joining this browser go into the figure library (#33).
watchFigures();
// The app kept on the device, for offline play and installing (#34). Not in development, where it
// would hold on to old modules. Installing it downloads the whole app, so it waits until the page has
// loaded and the browser is idle: the first visit's lobby and table come first (perf/budget.md, load).
if (import.meta.env.PROD) {
  const later = () =>
    (window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2000)))(
      () => void registerServiceWorker()?.catch(() => {}),
      { timeout: 10_000 },
    );
  if (document.readyState === "complete") later();
  else addEventListener("load", later, { once: true });
}
listenForInstall();

// A self-hosted build reads its relay and TURN logins from the server first (src/net/config.ts).
// …and the player's language (#35), so the first render is already in it.
void Promise.all([loadSiteConfig(), loadLanguage()]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

// Expose the store in development for debugging and browser tests.
if (import.meta.env.DEV) {
  Object.assign(window, {
    openBattle: useStore,
    openBattleCore: core,
    openBattleAssets: useAssets,
    openBattleTouch: useTouch,
  });
  void import("./dev/perf").then(({ perf }) => Object.assign(window, { openBattlePerf: perf }));
  void import("./dev/soak").then(({ soakBrowser }) => Object.assign(window, { openBattleSoak: soakBrowser }));
}
