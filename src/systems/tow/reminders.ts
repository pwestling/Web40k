import { alive, inCombat } from "./combat";
import { frenzied, hasRule, randomMovement } from "./specialRules";
import type { Unit } from "../../core/types";
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

/**
 * The formation a unit is in, if its rules don't allow it (#66): a unit that
 * lists any of Close Order, Open Order or Skirmishers (Lumbering counts as
 * close order) may take only those. Units listing none aren't checked.
 */
export function formationWarning(u: Unit): string | null {
  const may = {
    close: hasRule(u, /^(close order|lumbering)\b/i),
    open: hasRule(u, /^open order\b/i),
    skirmish: hasRule(u, /^skirmishers?\b/i),
  };
  if (!may.close && !may.open && !may.skirmish) return null;
  const f = u.formation;
  const now =
    f.kind === "skirmish"
      ? "skirmish"
      : f.order === "open"
        ? "open"
        : f.order === "close" || !f.order
          ? "close"
          : null;
  if (!now || may[now]) return null;
  const allowed = [
    may.close && "close order",
    may.open && "open order",
    may.skirmish && "a skirmish formation",
  ]
    .filter(Boolean)
    .join(" or ");
  const label = now === "skirmish" ? "a skirmish formation" : `${now} order`;
  return `${u.name} is in ${label}, but its rules allow only ${allowed}`;
}

export function towReminders(view: GameView): Warning[] {
  const state = view.state;
  const me = view.activePlayer;
  if (!me) return [];
  const out: Warning[] = [];
  const mine = Object.values(state.units).filter(
    (u) => !opposed(state, u.owner, me) && alive(state, u).length > 0,
  );
  for (const u of mine) {
    const why = formationWarning(u);
    if (why) out.push({ id: "towFormation", unitId: u.id, severity: "info", message: why });
  }
  if (view.phase === "movement") {
    for (const u of mine) {
      if (hasRule(u, /^swiftstride\b/i) && !u.status?.fleeing && !u.status?.charged && !inCombat(view, u.id))
        out.push({
          id: "towSwiftstride",
          unitId: u.id,
          severity: "info",
          message: `${u.name} has Swiftstride: a charge reaches 3" further, and it may add D6 to its charge roll (by hand); its flee and pursuit rolls add it already`,
        });
      const random = randomMovement(state, u);
      if (random && !u.status?.fleeing && !inCombat(view, u.id))
        out.push({
          id: "towRandomMovement",
          unitId: u.id,
          severity: "info",
          message: `${u.name} moves at random (M ${random.text}): roll it each time it moves, and roll it to charge (it is the charge's whole reach)`,
        });
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
        // A random Movement reaches as far as its dice can roll, with no charge roll on top.
        const random = randomMovement(state, u);
        const reach = random ? random.count * random.sides + random.bonus : m + MAX_CHARGE_ROLL;
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
