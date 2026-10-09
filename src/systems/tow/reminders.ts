import { alive, inCombat } from "./combat";
import { frenzied } from "./specialRules";
import { opposed } from "../../core/teams";
import { unitGap } from "../../core/manoeuvre";
import type { GameView, Warning } from "../../sdk";

/**
 * Manual reminders at the right timing (the Table warnings panel): rules the
 * app doesn't play itself but a player shouldn't forget. Names and our own
 * words only; the players resolve each one by hand.
 */

/** The furthest a charge can reach: Movement plus the highest a D6 can roll. */
const MAX_CHARGE_ROLL = 6;

export function towReminders(view: GameView): Warning[] {
  const state = view.state;
  const me = view.activePlayer;
  if (!me) return [];
  const out: Warning[] = [];
  const mine = Object.values(state.units).filter(
    (u) => !opposed(state, u.owner, me) && alive(state, u).length > 0,
  );
  if (view.phase === "movement") {
    for (const u of mine) {
      if (u.status?.fleeing)
        out.push({
          id: "towCompulsoryFlee",
          unitId: u.id,
          severity: "info",
          message: `${u.name} is fleeing: in the compulsory moves it flees again (2D6) away from the nearest enemy`,
        });
      else if (u.status?.stupid)
        out.push({
          id: "towStupidMove",
          unitId: u.id,
          severity: "info",
          message: `${u.name} is stupid this turn: move it straight ahead with the compulsory moves`,
        });
      else if (frenzied(u) && !u.status?.charged && !u.status?.marching && !inCombat(view, u.id)) {
        const m = Number((view.unit(u.id) as Record<string, unknown> | undefined)?.M) || 0;
        const reach = m + MAX_CHARGE_ROLL;
        const prey = Object.values(state.units).some(
          (e) =>
            opposed(state, e.owner, u.owner) &&
            !e.status?.fleeing &&
            alive(state, e).length > 0 &&
            unitGap(state, u, e) <= reach &&
            (view.atTable || view.visible(u.id, e.id)),
        );
        if (prey)
          out.push({
            id: "towFrenzyCharge",
            unitId: u.id,
            severity: "info",
            message: `${u.name} is frenzied: it must declare a charge if it can`,
          });
      }
    }
  }
  if (view.phase === "shooting") {
    for (const u of Object.values(state.units)) {
      if (!opposed(state, u.owner, me) || !u.joined?.length || !alive(state, u).length) continue;
      out.push({
        id: "towLookOutSir",
        unitId: u.id,
        severity: "info",
        message: `${u.name} has a character with it: Look Out, Sir! may save it from shots (by hand)`,
      });
    }
  }
  return out;
}
