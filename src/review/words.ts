import type { GameState } from "../core";
import { playerActions } from "../core/content/player";
import { systemOf } from "../core/content/turn";
import { explain, unitLabel } from "../bot/explain";
import { gameModule } from "../systems";
import { gameText, t, tn } from "../i18n";
import type { BotMove } from "../soak/bot";
import type { Decision, GameReview, Mark } from "./analyse";

/**
 * The game review's words (#61): a decision as a player would say it, and
 * three plain takeaways per side. Sizes are in victory points, rounded, as
 * the evaluator's scale is roughly that.
 */

const seatOfUnit = (state: GameState, id: string) => state.players[state.units[id]?.owner ?? ""]?.seat;
const unitName = unitLabel;

/** A decision in two parts: the unit, and what it did ("going for the East lantern"). */
export function movePhrase(
  state: GameState,
  move: BotMove | null,
): {
  unit: string;
  what: string;
  /** "using Focused Fire on their Line Troopers", for "Ended the turn without…" */ doing?: string;
} {
  if (!move) return { unit: "", what: t("moving on to the next phase") };
  const i = move.intent;
  const why = explain(state, move)?.text;
  if (i.type === "player/action") {
    const army = Object.values(state.armies ?? {}).flatMap((a) => a?.stratagems ?? []);
    const name =
      army.find((s) => i.action.endsWith(`:${s.id}`))?.name ??
      playerActions(state, move.as).find((o) => o.def.id === i.action)?.def.name ??
      i.action;
    const target = unitName(state, i.targetId);
    const action = gameText(name);
    if (!target)
      return { unit: "", what: t("used {action}", { action }), doing: t("using {action}", { action }) };
    // "used Focused Fire on their Lance Team": a stratagem, not a shooting target (UX 426). "Their" says whose.
    const own = i.targetId && seatOfUnit(state, i.targetId) === state.players[move.as]?.seat;
    const unit = own ? state.units[i.targetId!]!.name : target;
    return own
      ? {
          unit: "",
          what: t("used {action} on their {unit}", { action, unit }),
          doing: t("using {action} on their {unit}", { action, unit }),
        }
      : {
          unit: "",
          what: t("used {action} on the enemy {unit}", { action, unit }),
          doing: t("using {action} on the enemy {unit}", { action, unit }),
        };
  }
  if (i.type === "action/take") {
    const unit = unitName(state, i.unitId) ?? "";
    const def = systemOf(state).actions.find((a) => a.id === i.action);
    const action = gameText(def?.name ?? i.action);
    const weapon = i.weapon ? state.units[i.unitId]?.sheet?.weapons?.[i.weapon]?.name : undefined;
    const what = why ?? (weapon ? t("{action} with {weapon}", { action, weapon }) : action);
    return { unit, what: why && !i.targetId ? t("{action}, {why}", { action, why }) : what };
  }
  if (i.type === "script/start") {
    const unit = unitName(state, typeof i.args?.unit === "string" ? i.args.unit : undefined) ?? "";
    const name = gameModule(state.system)?.actions?.find((a) => a.id === i.procedure)?.name ?? i.procedure;
    return { unit, what: why ?? gameText(name) };
  }
  if (i.type === "models/move") {
    const unit = unitName(state, i.moves[0] ? state.models[i.moves[0].id]?.unitId : undefined) ?? "";
    return { unit, what: why ?? t("moving") };
  }
  return { unit: "", what: why ?? i.type };
}

/**
 * A move as words in a sentence, with no colon after the unit (PX review words 3): "Bastion Walker
 * closing on Cinder Colossus", "Line Troopers' Advance, going for the East lantern", "used Focused
 * Fire on their Lance Team".
 */
export function moveText(state: GameState, move: BotMove | null): string {
  const { unit, what } = movePhrase(state, move);
  if (!unit) return what;
  // A description ("closing on…") follows the unit; an action's name ("Advance") is the unit's.
  if (what.charAt(0) !== what.charAt(0).toUpperCase()) return t("{unit} {what}", { unit, what });
  return /s$/.test(unit) ? t("{unit}' {what}", { unit, what }) : t("{unit}'s {what}", { unit, what });
}

/**
 * A turning point's size as chance to win for the side that made it, in whole
 * percent (UX 425): the evaluator's VP read through the same curve as the
 * result line, from where that side stood at the time.
 */
export function winShare(review: GameReview, m: Mark): number {
  const d = review.decisions[m.decision]!;
  const k = 0.6 * Math.max(1, review.scale);
  let p = review.points[0]?.p ?? 0.5;
  for (const q of review.points) if (q.seq <= d.seq) p = q.p;
  const mine = Math.min(0.99, Math.max(0.01, d.seat === (review.seats[0] ?? 0) ? p : 1 - p));
  const u = k * Math.log(mine / (1 - mine));
  const s = Math.abs(m.size);
  const sig = (v: number) => 1 / (1 + Math.exp(-v / k));
  // A costly or missed choice (or a bad roll) left the side short of u + s; a strong one (or a good roll) lifted it from u − s.
  const behind = m.kind === "costly" || m.kind === "missed" || (m.kind === "dice" && m.size < 0);
  return Math.max(1, Math.round(100 * (behind ? sig(u + s) - sig(u) : sig(u) - sig(u - s))));
}

type Kind = "move" | "attack" | "stratagem" | "other";

function kindOf(d: Decision): Kind {
  const m = d.played;
  if (!m) return "other";
  const i = m.intent;
  if (i.type === "player/action") return "stratagem";
  if (m.then?.intent.type === "models/move" || i.type === "models/move") return "move";
  if ((i.type === "action/take" && i.targetId) || (i.type === "script/start" && i.args?.target))
    return "attack";
  return "other";
}

/**
 * What to take from the game, for one side (PX feel pass a): first what went
 * well (its best call, or how many of its choices matched the best on offer),
 * then at most two things to try next game, then how the dice ran if there's
 * room. Encouraging, not a scolding.
 */
export function takeaways(review: GameReview, states: (seq: number) => GameState, seat: number): string[] {
  const army = review.scale;
  const mine = review.decisions.filter((d) => d.seat === seat);
  const cost: Record<Kind, { loss: number; n: number; costly: number }> = {
    move: { loss: 0, n: 0, costly: 0 },
    attack: { loss: 0, n: 0, costly: 0 },
    stratagem: { loss: 0, n: 0, costly: 0 },
    other: { loss: 0, n: 0, costly: 0 },
  };
  for (const d of mine) {
    // A tip only from choices the review benchmark backs judging (#63).
    if (!d.played || !d.trusted) continue;
    const c = cost[kindOf(d)];
    c.loss += d.loss;
    c.n++;
    if (d.loss >= 0.02 * army) c.costly++;
  }
  // The lead: the best call, else how often the side matched the best on offer.
  const ofSide = (kind: Mark["kind"]) =>
    review.marks
      .filter((m) => m.kind === kind && review.decisions[m.decision]!.seat === seat)
      .sort((a, b) => b.size - a.size)[0];
  const strong = ofSide("strong");
  const judged = mine.filter((d) => d.played).length;
  const clean = mine.filter((d) => d.played && d.loss < 0.02 * army).length;
  let lead: string | null = null;
  if (strong) {
    const d = review.decisions[strong.decision]!;
    lead = t(
      "Your best call: {move} in round {round}, about {n}% more chance to win than anything else on offer.",
      {
        move: moveText(states(d.seq), d.played),
        round: d.round,
        n: winShare(review, strong),
      },
    );
  } else if (judged)
    lead = t("{clean} of your {n} choices were as good as the best on offer.", { clean, n: judged });
  // Up to two things to try next game, the costliest first. Only one is said as an order ("Next
  // game, …"); a second reads as an observation (PX review words 1).
  const tips: { weight: number; text: string; seen?: string }[] = [];
  const worstKind = (["move", "attack", "stratagem"] as Kind[]).sort(
    (a, b) => cost[b].loss - cost[a].loss,
  )[0]!;
  const w = cost[worstKind];
  if (w.loss >= 0.1 * army && w.costly)
    tips.push({
      weight: w.loss,
      text:
        worstKind === "move"
          ? tn(
              w.costly,
              "Next game, before a move, look at where the enemy can shoot next turn ({n} move could have done better).",
              "Next game, before a move, look at where the enemy can shoot next turn ({n} moves could have done better).",
            )
          : worstKind === "attack"
            ? tn(
                w.costly,
                "Next game, finish off a unit you've hurt before starting on a fresh one ({n} attack could have done better).",
                "Next game, finish off a unit you've hurt before starting on a fresh one ({n} attacks could have done better).",
              )
            : t("Next game, keep stratagems for the attack that needs them."),
      seen:
        worstKind === "move"
          ? tn(w.costly, "{n} move could have done better.", "{n} moves could have done better.")
          : worstKind === "attack"
            ? tn(w.costly, "{n} attack could have done better.", "{n} attacks could have done better.")
            : t("Some stratagems went where they mattered less."),
    });
  const missed = mine.filter((d) => !d.played);
  if (missed.length)
    tips.push({
      weight: missed.reduce((a, d) => a + d.loss, 0),
      text: tn(
        missed.length,
        "Next game, check every unit before pressing ▶ ({n} phase ended with something still worth doing).",
        "Next game, check every unit before pressing ▶ ({n} phases ended with something still worth doing).",
      ),
      seen: tn(
        missed.length,
        "{n} phase ended with a unit that still had something worth doing.",
        "{n} phases ended with units that still had something worth doing.",
      ),
    });
  const costly = ofSide("costly");
  if (costly) {
    const d = review.decisions[costly.decision]!;
    const st = states(d.seq);
    // The unit named once, and a sentence rather than a log line (PX review words 2).
    tips.push({
      weight: costly.size * 0.7,
      text: t("One to replay: in round {round}, {move}; {better} was worth about {n}% more chance to win.", {
        move: moveText(st, d.played),
        round: d.round,
        better: betterText(st, d.played, d.best),
        n: winShare(review, costly),
      }),
    });
  }
  const out = [
    ...(lead ? [lead] : []),
    ...tips
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((x, i, top) => (x.seen && top.slice(0, i).some((y) => y.seen) ? x.seen : x.text)),
  ];
  // The dice, last and kindly, when there's room.
  const luck = review.totals[seat]?.luck ?? 0;
  if (out.length < 3 && Math.abs(luck) >= 0.08 * army)
    out.push(
      luck > 0
        ? t("The dice were kind to you this game.")
        : t("The dice were against you this game. That part wasn't up to you."),
    );
  return out;
}

/**
 * The better move, beside the one played: the unit not named twice, and when both read the same,
 * what was different (PX review words 4): the same move to another spot.
 */
export function betterText(state: GameState, played: BotMove | null, best: BotMove | null): string {
  if (!best) return "";
  const a = movePhrase(state, played);
  const b = movePhrase(state, best);
  if (b.what === a.what && b.unit === a.unit) return t("the same move to a different spot");
  return b.unit && b.unit === a.unit ? b.what : moveText(state, best);
}

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
