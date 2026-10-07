import { DEFAULT_SYSTEM } from "../core";
import { registerSystem } from "../core/content";
import { registerCode } from "../core/script";
import type { GameModule } from "../sdk";
import type { SystemModule } from "./app";
import { fsdModule } from "./fsd/module";
import { towModule } from "./tow/module";
import { wh40kModule } from "./wh40k/module";

export type { SpecialDie, SystemModule, TemplateKind } from "./app";

/**
 * The built-in game modules (see src/sdk and the game modules spec). Each
 * pairs a system's rules data with the app glue in `app` and its code
 * procedures (core/script.ts).
 */
const BUILT_IN: GameModule<SystemModule>[] = [wh40kModule, fsdModule, towModule];

const MODULES = new Map<string, GameModule<SystemModule>>();

/** Adds a module and registers its rules with the engine. */
export function registerModule(m: GameModule<SystemModule>): void {
  registerSystem(m.system);
  if (m.procedures) registerCode(m.system.id, m.procedures);
  MODULES.set(m.system.id, m);
}

BUILT_IN.forEach(registerModule);

/** The game module for a system id, if one is registered. */
export function gameModule(id: string | undefined): GameModule<SystemModule> | undefined {
  return MODULES.get(id ?? DEFAULT_SYSTEM);
}

/** The module for a system id; systems without one get the generic panels and an empty table. */
export function systemModule(id: string | undefined): SystemModule {
  return (
    gameModule(id)?.app ?? {
      sample: () => ({ name: "Empty", units: [], warnings: [] }),
      layout: () => ({ terrain: [], objectives: [], zones: [] }),
    }
  );
}
