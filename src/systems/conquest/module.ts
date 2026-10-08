import { lazy } from "react";
import { holdTheField } from "../../missions/holdTheField";
import type { GameModule } from "../../sdk";
import type { SystemModule } from "../app";
import { characterActions } from "./characters";
import { conquestFunctions, conquestProcedures } from "./command";
import { conquestLayout, CONQUEST_CATEGORIES } from "./layout";
import { moraleProcedures } from "./morale";
import { leavingCommand } from "./leaving";
import { reinforceProcedures } from "./reinforce";
import { conquestSample } from "./sample";
import { conquest } from "./system";

/** Conquest: roll-under regiments, a command stack and alternating activations (system.ts). */
export const conquestModule: GameModule<SystemModule> = {
  id: conquest.id,
  version: conquest.version,
  api: 1,
  system: conquest,
  procedures: { ...conquestProcedures, ...moraleProcedures, ...reinforceProcedures },
  functions: conquestFunctions,
  actions: characterActions,
  app: {
    sample: conquestSample,
    layout: (t) => conquestLayout(t.width, t.depth),
    templateCategory: CONQUEST_CATEGORIES,
    rankRules: () => ({ width: 2, maxBonus: 0 }),
    chargeRoll: { count: 1, sides: 6, keep: "sum" },
    // The panel (and the lesson code it reaches) loads with the game screen, not the front door.
    panel: lazy(() => import("./CommandPanel").then((m) => ({ default: m.CommandPanel }))),
    missions: [holdTheField()],
    leaving: leavingCommand,
  },
};
