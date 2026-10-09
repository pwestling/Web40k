import { describe } from "vitest";
import type { GameEvent, GameState } from "../core";
import { actionTargets } from "../core/content/play";
import { abilityReminders } from "../core/content/player";
import { currentSlot } from "../core/content/turn";
import { unitGap } from "../core/manoeuvre";
import { sampleRoster } from "../systems/wh40k/sample";
import { fightOrder, fightOutOfOrder } from "../systems/wh40k/fight";
import { moveWarnings, scenarioSuite, withRules } from "./suite";

/**
 * #40: damage re-rolls, save modifiers and Damage −1 from automated sample
 * abilities, and the 11th edition core stratagems. #57: Indirect Fire at
 * units out of sight, the fight order and Fights First, Hazardous rolls,
 * charges at a target within 12", core rule reminders and the new table checks.
 */
const watch = (s: GameState, events: GameEvent[], before: GameState): string[] => {
  const records = [...(s.procedure?.run.records ?? []), ...(s.attack?.run?.records ?? [])];
  const tags = records.flatMap((r) => r.fired.map((name) => `${name}: ${r.id}`));
  if (records.some((r) => r.damage?.some((d) => d.rerolledFrom !== undefined))) tags.push("damage re-rolled");
  // 11th edition stratagems: the bot plays whatever the table offers.
  for (const uses of Object.values(s.used ?? {}))
    for (const u of uses) {
      tags.push(`stratagem ${u.action}`);
      if (u.action === "rapidIngress" && u.round <= 1) tags.push("Rapid Ingress in round 1");
      if (u.action === "goToGround") tags.push("Go to Ground");
    }
  const outcomes = s.procedure?.run.outcomes ?? [];
  if (outcomes.some((o) => o.kind === "note" && /^Hazardous: rolled \d/.test(o.text)))
    tags.push("Hazardous roll");
  for (const e of events) {
    if (e.type !== "action/take") continue;
    const unit = before.units[e.unitId];
    const target = e.targetId ? before.units[e.targetId] : undefined;
    if (!unit) continue;
    if (e.action === "shoot" && target) {
      // A target the unit's other guns couldn't pick: out of sight, for Indirect Fire.
      const indirect = unit.sheet?.weapons[e.weapon ?? ""]?.keywords.some((k) => /^indirect fire$/i.test(k));
      const seen = actionTargets(before, unit.id, "shoot").find((t) => t.unitId === target.id)?.ok;
      if (indirect && !seen) tags.push("Indirect Fire at a unit out of sight");
    }
    if (e.action === "charge") {
      if (target && unitGap(before, unit, target) <= 12) tags.push('charge at a target within 12"');
      if (target && unitGap(before, unit, target) > 12) tags.push('charge at a target over 12"');
      if (actionTargets(before, unit.id, "charge").some((t) => !t.ok && t.why === 'Further than 12"'))
        tags.push('charge target further than 12" greyed out');
    }
    if (e.action === "fight") {
      const order = fightOrder(before);
      const why = fightOutOfOrder(before, unit.id);
      if (why) tags.push(`fought out of order (${why})`);
      else if (
        order?.step === "fightsFirst" &&
        unit.sheet?.abilities.some((a) => /^fights first$/i.test(a.name))
      )
        tags.push("a Fights First unit fought first");
      if (!why && order?.step === "remaining" && order.eligible.includes(unit.id))
        tags.push("fought in turn (alternating picks)");
    }
  }
  // Core rule reminders (Transport, Desperate Escape, ...) as a Movement phase begins.
  if (currentSlot(s)?.id === "movement" && currentSlot(before)?.id !== "movement")
    for (const r of abilityReminders(s)) if (r.rule) tags.push(`rule reminder: ${r.ability.name}`);
  tags.push(...moveWarnings(s, events));
  return tags;
};

/** The sample armies with a few invented rules to exercise: Hazardous guns, a Transport each side, Fights First. */
const armies = (seat: 0 | 1) =>
  withRules(
    sampleRoster(seat),
    seat === 0
      ? {
          "Lance Team": { weapons: { "Arc Lance": { keywords: ["Hazardous"] } } },
          "Line Troopers": { weapons: { "Fusion Caster": { keywords: ["Hazardous"] } } },
          "Rampart Battle Tank": {
            keywords: ["Transport"],
            weapons: { "Siege Cannon": { keywords: ["Indirect Fire"] } },
          },
          "Field Marshal": { abilities: ["Fights First"] },
        }
      : {
          "Cinder Brutes": {
            abilities: ["Fights First"],
            weapons: { "Bone Drill": { keywords: ["Hazardous"] } },
          },
          "Slag Crawler": { keywords: ["Transport"] },
        },
  );

describe("rules gaps: 40k", () =>
  scenarioSuite(
    "40k damage and saves",
    "forty-k-11",
    { automate: true, watch, armies },
    [
      "Armoured Hull: damage",
      "Searing Grip: damage",
      "Fused Plates: save",
      "stratagem commandReroll",
      // #57
      "Indirect Fire at a unit out of sight",
      "Indirect Fire: hit",
      "Hazardous roll",
      'charge at a target within 12"',
      "a Fights First unit fought first",
      "fought out of order (pick)",
      "rule reminder: Transport",
      "warning terrain",
    ],
    ["Rapid Ingress in round 1", "Go to Ground", 'charge at a target over 12"'],
  ));
