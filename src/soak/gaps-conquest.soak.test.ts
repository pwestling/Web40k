import { describe } from "vitest";
import type { GameEvent, GameState } from "../core";
import { actionTargets } from "../core/content/play";
import { moveWarnings, scenarioSuite } from "./suite";

/**
 * #40: Conquest special rules from the sample armies, Supremacy each round, Broken on the worst Resolve.
 * #57: charges at an enemy in the front arc and in sight, landing or falling short; Inspired
 * re-rolling natural 6s; the march warnings; the command stand removed last.
 */
const watch = (s: GameState, events: GameEvent[], before: GameState): string[] => {
  const tags = (s.procedure?.run.records ?? []).flatMap((r) => r.fired.map((name) => `${name}: ${r.id}`));
  if (s.rolledOff) tags.push(`Supremacy to seat ${s.rolledOff.seat}`);
  const target = s.procedure?.run.roles.target;
  const id = target && "unit" in target ? target.unit : undefined;
  if (id && s.units[id]?.status?.broken && s.procedure?.run.records.some((r) => r.id.startsWith("resolve")))
    tags.push("Broken regiment tested Resolve");
  const hit = s.procedure?.run.records.find((r) => r.id === "hit");
  if (hit?.dice?.some((d) => d.rerolledFrom === 6) && hit.fired.some((f) => /re-roll natural 6s/.test(f)))
    tags.push("Inspired re-rolled a natural 6");
  for (const e of events) {
    const notes =
      e.type === "script/step" ? e.events.flatMap((x) => (x.type === "log/note" ? [x.text] : [])) : [];
    for (const n of notes) {
      if (/'s charge lands/.test(n)) tags.push("a charge landed");
      if (/'s charge falls short/.test(n)) tags.push("a charge fell short");
      if (/can reach .*charges straight ahead/.test(n)) tags.push("a charge roll reached");
    }
    if (e.type === "action/take" && e.action === "charge" && e.targetId) {
      const targets = actionTargets(before, e.unitId, "charge");
      if (targets.find((t) => t.unitId === e.targetId)?.ok)
        tags.push("charged an enemy in the front arc and seen");
      else tags.push("charged an enemy out of the front arc or sight");
      if (targets.some((t) => !t.ok)) tags.push("an enemy out of the front arc or sight left out");
    }
  }
  // Casualties: the command stand goes last of its regiment.
  for (const m of Object.values(s.models)) {
    const was = before.models[m.id];
    if (!m.destroyed || !was || was.destroyed || !/\bcommand\b/i.test(m.profile?.name ?? "")) continue;
    const unit = m.unitId ? s.units[m.unitId] : undefined;
    const left = unit?.modelIds.some((x) => x !== m.id && s.models[x] && !s.models[x]!.destroyed);
    tags.push(left ? "a command stand removed before its regiment" : "a command stand removed last");
  }
  tags.push(...moveWarnings(s, events));
  return tags;
};

describe("rules gaps: Conquest", () =>
  // Eight games: since volleys count only stands with a clear shot (#57), a few rarely break a regiment
  // (five stopped being enough once the command stand moved to the centre of the front rank, #58).
  scenarioSuite(
    "Conquest special rules and Supremacy",
    "conquest-hand",
    { watch, minSeeds: 8 },
    [
      "Flurry: hit",
      "Terrifying: resolve",
      "Deadly Blades: defense",
      "Broken regiment tested Resolve",
      "Supremacy to seat 0",
      "Supremacy to seat 1",
      // #57
      "charged an enemy in the front arc and seen",
      "an enemy out of the front arc or sight left out",
      "a charge landed",
      "a charge fell short",
      "Inspired re-rolled a natural 6",
      "warning marchRate",
      "warning marchNearEnemy",
      "a command stand removed last",
    ],
    ["charged an enemy out of the front arc or sight", "a command stand removed before its regiment"],
  ));
