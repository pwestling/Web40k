import type { GameModule } from "../../sdk";
import type { SystemModule } from "../app";
import { towLayout, TOW_CATEGORIES } from "./layout";
import { towSample } from "./sample";
import { oldWorld } from "./system";
import { TOW_DICE, TOW_TEMPLATES } from "./templates";
import { towRanks } from "./troops";

/** Rank and flank in the style of The Old World. Combat, reactions and break tests come as code procedures. */
export const towModule: GameModule<SystemModule> = {
  id: oldWorld.id,
  version: oldWorld.version,
  api: 1,
  system: oldWorld,
  app: {
    sample: towSample,
    layout: (t) => towLayout(t.width, t.depth),
    templateCategory: TOW_CATEGORIES,
    rankRules: towRanks,
    templates: TOW_TEMPLATES,
    specialDice: TOW_DICE,
    scatter: { direction: "scatter", distance: "artillery" },
    fleeDice: "2D6",
    chargeRoll: { count: 2, sides: 6, keep: "highest" },
  },
};
