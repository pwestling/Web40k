import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useAssets } from "./assets/store";
import * as core from "./core";
import { useStore } from "./store";
import "./styles.css";
import { loadSiteConfig } from "./net/config";
import { watchFigures } from "./figures/library";
import { registerServiceWorker } from "./sw/register";
import { watchErrors } from "./ui/report";
import { applyTextSize } from "./ui/textSize";

// Recent errors go into a problem report (src/ui/report.ts).
watchErrors();
// The player's text size (#25).
applyTextSize();
// Models joining this browser go into the figure library (#33).
watchFigures();
// The app kept on the device, for offline play and installing (#34). Not in development, where it
// would hold on to old modules.
if (import.meta.env.PROD) void registerServiceWorker()?.catch(() => {});

// A self-hosted build reads its relay and TURN logins from the server first (src/net/config.ts).
void loadSiteConfig().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

// Expose the store in development for debugging and browser tests.
if (import.meta.env.DEV) {
  Object.assign(window, { openBattle: useStore, openBattleCore: core, openBattleAssets: useAssets });
  void import("./dev/perf").then(({ perf }) => Object.assign(window, { openBattlePerf: perf }));
  void import("./dev/soak").then(({ soakBrowser }) => Object.assign(window, { openBattleSoak: soakBrowser }));
}
