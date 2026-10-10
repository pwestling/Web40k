import { create } from "zustand";
import { opposed, unitGap, type GameState, type UnitId } from "../core";
import { phaseName } from "../core/content/turn";
import { actionTargets } from "../core/content/play";
import { t } from "../i18n";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { chargeNeeded } from "../systems/wh40k/charge";
import {
  aliveModels,
  carriers,
  mainWeapon,
  unitDistance,
  unitSight,
  weaponReach,
} from "../systems/wh40k/rules";

/**
 * Acting on the table (UX 84, proposal 1): with one of your units picked, an
 * enemy under the pointer says what a click on it does this phase, and the
 * click does it: Shooting shoots with everything that reaches, Charge
 * declares the charge, Fight fights. The tag says facts only (weapons,
 * distance, sight, cover; no odds in a live game). Out of reach the click
 * picks the enemy, as before, and Shift+click does it anyway (rules are
 * advisory). The dice are rolled as ever: on screen, or the player's own.
 */

interface TableVerb {
  verb: "shoot" | "charge" | "fight";
  /** It fits: in range, in reach, in this phase. */
  ok: boolean;
  /** "Shoot", or why not. */
  line: string;
  facts: string[];
}

const inches = (n: number) => `${n.toFixed(1)}"`;

/** What a click on `targetId` does with `attackerId`, if anything (40k's phases). */
export function tableVerb(game: GameState, attackerId: UnitId, targetId: UnitId): TableVerb | null {
  if (!systemModule(game.system).dedicatedUi || game.turn.round === 0) return null;
  const unit = game.units[attackerId];
  const target = game.units[targetId];
  if (!unit || !target || attackerId === targetId || !opposed(game, target.owner, unit.owner)) return null;
  const theirs = aliveModels(game, target);
  if (!theirs.length || !aliveModels(game, unit).length) return null;
  const gap = unitGap(game, unit, target);
  switch (phaseName(game)) {
    case "Shooting": {
      const reaching: string[] = [];
      const shooters = new Set<string>();
      let longest = 0;
      for (const w of Object.values(unit.sheet?.weapons ?? {})) {
        if (w.kind !== "ranged") continue;
        const reach = weaponReach(w) ?? 0;
        longest = Math.max(longest, reach);
        const near = carriers(game, unit, w.id).filter((m) => unitDistance([m], theirs) <= reach);
        if (!near.length) continue;
        reaching.push(`${near.length}× ${w.name}`);
        for (const m of near) shooters.add(m.id);
      }
      if (!longest) return null;
      if (!reaching.length)
        return {
          verb: "shoot",
          ok: false,
          line: t("Out of range: {distance} (its longest reach is {reach})", {
            distance: inches(gap),
            reach: inches(longest),
          }),
          facts: [],
        };
      const sight = unitSight(
        game,
        aliveModels(game, unit).filter((m) => shooters.has(m.id)),
        target,
      );
      return {
        verb: "shoot",
        ok: sight.visible > 0,
        line: sight.visible > 0 ? t("Shoot") : t("Not in sight"),
        facts: [
          ...reaching,
          inches(gap),
          ...(sight.visible > 0 && sight.visible < theirs.length
            ? [t("{n} of {all} models seen", { n: sight.visible, all: theirs.length })]
            : []),
          ...(sight.inCover ? [t("in cover")] : []),
        ],
      };
    }
    case "Charge": {
      const fits = actionTargets(game, attackerId, "charge").find((x) => x.unitId === targetId);
      const needed = chargeNeeded(game, attackerId, [targetId]);
      const ok = !!fits?.ok && needed <= 12;
      return {
        verb: "charge",
        ok,
        line: ok ? t("Charge") : (fits?.why ?? t("Too far to charge")),
        facts: [
          t("{distance} away", { distance: inches(gap) }),
          needed > 0 ? t("needs {n}+", { n: needed }) : t("already in reach"),
        ],
      };
    }
    case "Fight": {
      if (!mainWeapon(game, unit, "melee")) return null;
      const engaged = gap <= 1.05;
      return {
        verb: "fight",
        ok: engaged,
        line: engaged ? t("Fight") : t("Not in engagement range: {distance}", { distance: inches(gap) }),
        facts: [],
      };
    }
  }
  return null;
}

/** A charge declared from the table, picked up by the unit card's charge (ChargeDeclare). */
export const useChargeAsk = create<{ ask: { unitId: UnitId; targets: UnitId[] } | null }>(() => ({
  ask: null,
}));

/** Do the verb: the attack panel set up at the target, or the charge declared on the card. */
export function doTableVerb(verb: TableVerb, attackerId: UnitId, targetId: UnitId): void {
  const s = useStore.getState();
  const unit = s.game.units[attackerId];
  if (!unit) return;
  if (verb.verb === "shoot") s.setDraft({ attackerId, kind: "ranged", all: true, targetId, picking: false });
  else if (verb.verb === "fight") {
    const weaponId = mainWeapon(s.game, unit, "melee");
    s.setDraft({ attackerId, kind: "melee", ...(weaponId ? { weaponId } : {}), targetId, picking: false });
  } else {
    s.select(attackerId);
    useChargeAsk.setState({ ask: { unitId: attackerId, targets: [targetId] } });
  }
}
