import { describe, expect, it } from "vitest";
import "../systems";
import { applyEvent, sidePlayers, type GameRecord, type GameState } from "../core";
import { actionTargets } from "../core/content/play";
import { maxWounds, woundsRemaining } from "../core/attack";
import { currentSlot, systemOf } from "../core/content/turn";
import { playMatch } from "../bot/match";
import { analyst, botPolicy } from "../bot/player";
import { reaches, type BotMove } from "../soak/bot";

const alive = (s: GameState, unit: string) =>
  s.units[unit]!.modelIds.filter((id) => !s.models[id]!.destroyed);
const wounds = (s: GameState, unit: string) =>
  alive(s, unit).reduce((n, id) => n + woundsRemaining(s.models[id]!), 0);

/**
 * A shooting phase in a played game where one of the active side's units can
 * shoot either of two enemy units: the one it chose, if it has more than a
 * wound left, is cut down to its last model with one wound.
 */
function finishingChance(record: GameRecord) {
  let s = record.initial;
  let start: GameState | null = null;
  for (let i = 0; i < record.events.length; i++) {
    const st = s;
    s = { ...applyEvent(s, record.events[i]!.event), seq: record.events[i]!.seq };
    if (st.turn.round === 0 || st.script || st.procedure) continue;
    start ??= st;
    if (!/shoot/i.test(currentSlot(st)?.id ?? "")) continue;
    const shoot = systemOf(st).actions.find((a) => /shoot|fire/i.test(a.id) && a.procedure)!;
    const seat = st.turn.activeSeat;
    const prefix = { ...record, events: record.events.slice(0, i) };
    // The unit and weapon Steady fires first here, so it's one that can shoot.
    const player = sidePlayers(st, seat)[0]!.id;
    const first = botPolicy("steady", start, seat, { seed: 1 }).move(prefix, st, { seat, player });
    if (first?.intent.type !== "action/take" || first.intent.action !== shoot.id || !first.intent.weapon)
      continue;
    const { unitId, weapon } = first.intent;
    const u = st.units[unitId]!;
    const targets = actionTargets(st, unitId, shoot.id, weapon)
      .filter((t) => t.ok && reaches(st, u, weapon, t.unitId))
      .map((t) => t.unitId);
    // The unit Steady shoots at, cut down to its last model, and another it could shoot instead.
    const weak = first.intent.targetId;
    const fresh = targets.find((t) => t !== weak);
    if (!weak || !fresh || wounds(st, weak) < 2) continue;
    const models = { ...st.models };
    const [last, ...rest] = alive(st, weak);
    for (const id of rest) models[id] = { ...models[id]!, destroyed: true };
    models[last!] = { ...models[last!]!, woundsLost: maxWounds(models[last!]!) - 1 };
    const shot = (target: string): BotMove => ({
      intent: { type: "action/take", unitId, action: shoot.id, weapon, targetId: target },
      as: u.owner,
      kind: "test",
    });
    return { prefix, state: { ...st, models }, start, seat, weak, fresh, shot };
  }
  throw new Error("no shooting phase with two targets");
}

describe("what the review finds in Steady's play (#61)", () => {
  // Steady weighs every wound alike, so it spreads its shots (Sharp counts finishing a unit off,
  // evaluate.ts SHARP.finish). The review judges as Sharp does: a shot at a fresh unit, when another
  // was down to its last wound, costs; finishing it off is the best on offer.
  for (const system of ["forty-k-11", "tow-hand"])
    it(`marks a shot that leaves a unit on its last wound (${system})`, async () => {
      const r = await playMatch({ system, seed: 2, mirror: 0 }, (start) => [
        botPolicy("steady", start, 0, { seed: 2 }),
        botPolicy("steady", start, 1, { seed: 3 }),
      ]);
      const c = finishingChance(r.record!);
      const judge = (target: string) => {
        const a = analyst(c.start, c.seat).appraise(c.prefix, c.state, c.shot(target), new Set(), true);
        return { loss: (a.best?.score ?? a.base) - (a.played ?? a.base), best: a.best?.move };
      };
      const spread = judge(c.fresh);
      const finish = judge(c.weak);
      expect(spread.loss).toBeGreaterThan(0.25);
      expect(finish.loss).toBeLessThan(spread.loss / 4);
      const best = spread.best?.intent;
      expect(best?.type === "action/take" && best.targetId).toBe(c.weak);
    }, 240_000);
});
