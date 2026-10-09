import { TOW_MISSIONS } from "./missions";
import type { GameModule } from "../../sdk";
import { heavyLossesProcedure } from "./breaks";
import { inCombatFn, marchedNoShot } from "./combatKit";
import { towActions } from "./combat";
import { towReminders } from "./reminders";
import { magicActions } from "./magic";
import { characterActions } from "./characters";
import { itemActions } from "./items";
import { shooters, shootsOnHill, shootsRanked, shootsVolley } from "./ranks";
import { terrainActions, terrainWarnings } from "./terrainTests";
import { towHooks } from "./psychology";
import type { SystemModule } from "../app";
import { towLayout, TOW_CATEGORIES } from "./layout";
import { towSample } from "./sample";
import { oldWorld } from "./system";
import { TOW_DICE, TOW_TEMPLATES } from "./templates";
import { importTowRoster, MOUNT_GROUP, SPELL_GROUP } from "./roster";
import { towRanks } from "./troops";

/** Rank and flank in the style of The Old World. Combat, reactions, break tests, psychology and magic come as code procedures. */
export const towModule: GameModule<SystemModule> = {
  id: oldWorld.id,
  version: oldWorld.version,
  api: 1,
  system: oldWorld,
  actions: [...towActions, ...magicActions, ...characterActions, ...itemActions, ...terrainActions],
  procedures: { heavyLosses: heavyLossesProcedure },
  functions: { shooters, shootsOnHill, shootsVolley, shootsRanked, inCombat: inCombatFn, marchedNoShot },
  checks: (view) => [...terrainWarnings(view), ...towReminders(view)],
  hooks: towHooks,
  // Sharp's whole-turn plan judged against the enemy's guns: their whole turn played greedily
  // won fewer games here (58% against 69% of 64 with guns only, 2026-10-08).
  bot: { planReply: "shots" },
  app: {
    sample: towSample,
    importRoster: importTowRoster,
    // A mount's or crew's profile and a wizard's spells are listed with the unit's rules, but aren't ones.
    profileGroups: [MOUNT_GROUP, SPELL_GROUP],
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
