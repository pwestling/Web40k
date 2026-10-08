import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useAssets } from "./assets/store";
import * as core from "./core";
import { useStore } from "./store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Expose the store in development for debugging and browser tests.
if (import.meta.env.DEV) {
  Object.assign(window, { openBattle: useStore, openBattleCore: core, openBattleAssets: useAssets });
  void import("./dev/perf").then(({ perf }) => Object.assign(window, { openBattlePerf: perf }));
  void import("./dev/soak").then(({ soakBrowser }) => Object.assign(window, { openBattleSoak: soakBrowser }));
}
