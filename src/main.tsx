import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useAssets } from "./assets/store";
import * as core from "./core";
import { useStore } from "./store";
import "./styles.css";
import { loadSiteConfig } from "./net/config";
import { watchErrors } from "./ui/report";

// Recent errors go into a problem report (src/ui/report.ts).
watchErrors();

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
