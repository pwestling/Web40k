import { TOW_MISSIONS } from "./missions";
import type { GameModule } from "../../sdk";
import { towActions } from "./combat";
import { magicActions } from "./magic";
import { towHooks } from "./psychology";
import type { SystemModule } from "../app";
import { towLayout, TOW_CATEGORIES } from "./layout";
import { towSample } from "./sample";
import { oldWorld } from "./system";
import { TOW_DICE, TOW_TEMPLATES } from "./templates";
import { importTowRoster } from "./roster";
import { towRanks } from "./troops";

/** Rank and flank in the style of The Old World. Combat, reactions, break tests, psychology and magic come as code procedures. */
export const towModule: GameModule<SystemModule> = {
  id: oldWorld.id,
  version: oldWorld.version,
  api: 1,
  system: oldWorld,
  actions: [...towActions, ...magicActions],
  hooks: towHooks,
  app: {
    sample: towSample,
    importRoster: importTowRoster,
    layout: (t) => towLayout(t.width, t.depth),
    templateCategory: TOW_CATEGORIES,
    rankRules: towRanks,
    missions: TOW_MISSIONS,
    templates: TOW_TEMPLATES,
    specialDice: TOW_DICE,
    scatter: { direction: "scatter", distance: "artillery" },
    fleeDice: "2D6",
    chargeRoll: { count: 2, sides: 6, keep: "highest" },
  },
};
