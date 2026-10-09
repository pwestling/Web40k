import type { GameState } from "../core";
import { playerActions } from "../core/content/player";
import { systemOf } from "../core/content/turn";
import { sideName } from "../core/teams";
import { explain } from "../bot/explain";
import { gameModule } from "../systems";
import { formatNumber, gameText, t, tn } from "../i18n";
import type { BotMove } from "../soak/bot";
import type { Decision, GameReview, Mark } from "./analyse";

/**
 * The game review's words (#61): a decision as a player would say it, and
 * three plain takeaways per side. Sizes are in victory points, rounded, as
 * the evaluator's scale is roughly that.
 */

const vp = (n: number) => formatNumber(Math.abs(n), { maximumFractionDigits: 0 });

const seatOfUnit = (state: GameState, id: string) => state.players[state.units[id]?.owner ?? ""]?.seat;

/** A unit's name, with its side when the other side has a unit of the same name (UX 426). */
function unitName(state: GameState, id: string | undefined): string | undefined {
  const u = id ? state.units[id] : undefined;
  if (!u) return undefined;
  const seat = seatOfUnit(state, u.id);
  const twin = Object.values(state.units).some(
    (o) => o.id !== u.id && o.name === u.name && seatOfUnit(state, o.id) !== seat,
  );
  return twin && seat !== undefined
    ? t("{unit} ({side})", { unit: u.name, side: sideName(state, seat) })
    : u.name;
}

/** "Line Troopers: Advance, going for the East lantern", "Focused Fire on Bastion Walker". */
export function moveText(state: GameState, move: BotMove | null): string {
  if (!move) return t("moving on to the next phase");
  const i = move.intent;
  const why = explain(state, move)?.text;
  if (i.type === "player/action") {
    const army = Object.values(state.armies ?? {}).flatMap((a) => a?.stratagems ?? []);
    const name =
      army.find((s) => i.action.endsWith(`:${s.id}`))?.name ??
      playerActions(state, move.as).find((o) => o.def.id === i.action)?.def.name ??
      i.action;
    const target = unitName(state, i.targetId);
    if (!target) return t("used {action}", { action: gameText(name) });
    // "used Focused Fire on their Lance Team": a stratagem, not a shooting target (UX 426).
    const own = i.targetId && seatOfUnit(state, i.targetId) === state.players[move.as]?.seat;
    return own
      ? t("used {action} on their {unit}", { action: gameText(name), unit: target })
      : t("used {action} on the enemy {unit}", { action: gameText(name), unit: target });
  }
  if (i.type === "action/take") {
    const unit = unitName(state, i.unitId) ?? "";
    const def = systemOf(state).actions.find((a) => a.id === i.action);
    const action = gameText(def?.name ?? i.action);
    const weapon = i.weapon ? state.units[i.unitId]?.sheet?.weapons?.[i.weapon]?.name : undefined;
    const what = why ?? (weapon ? t("{action} with {weapon}", { action, weapon }) : action);
    return why && !i.targetId ? t("{unit}: {action}, {why}", { unit, action, why }) : `${unit}: ${what}`;
  }
  if (i.type === "script/start") {
    const unit = unitName(state, typeof i.args?.unit === "string" ? i.args.unit : undefined) ?? "";
    const name = gameModule(state.system)?.actions?.find((a) => a.id === i.procedure)?.name ?? i.procedure;
    return `${unit}: ${why ?? gameText(name)}`;
  }
  if (i.type === "models/move") {
    const unit = unitName(state, i.moves[0] ? state.models[i.moves[0].id]?.unitId : undefined) ?? "";
    return `${unit}: ${why ?? t("moving")}`;
  }
  return why ?? i.type;
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
 * Three things to take from the game, for one side, most telling first:
 * where its choices cost most, how its dice ran, its best and worst calls,
 * phases left with something still worth doing.
 */
export function takeaways(review: GameReview, states: (seq: number) => GameState, seat: number): string[] {
  const army = review.scale;
  const mine = review.decisions.filter((d) => d.seat === seat);
  const out: { weight: number; text: string }[] = [];
  const cost: Record<Kind, { loss: number; n: number; costly: number }> = {
    move: { loss: 0, n: 0, costly: 0 },
    attack: { loss: 0, n: 0, costly: 0 },
    stratagem: { loss: 0, n: 0, costly: 0 },
    other: { loss: 0, n: 0, costly: 0 },
  };
  for (const d of mine) {
    if (!d.played) continue;
    const c = cost[kindOf(d)];
    c.loss += d.loss;
    c.n++;
    if (d.loss >= 0.02 * army) c.costly++;
  }
  const worstKind = (Object.keys(cost) as Kind[]).sort((a, b) => cost[b].loss - cost[a].loss)[0]!;
  const w = cost[worstKind];
  if (w.loss >= 0.1 * army && w.costly) {
    const text =
      worstKind === "move"
        ? tn(
            w.costly,
            "Movement cost you most: {n} move gave up about {vp} VP. Before moving, look at where the enemy can shoot next turn.",
            "Movement cost you most: {n} moves gave up about {vp} VP between them. Before moving, look at where the enemy can shoot next turn.",
            { vp: vp(w.loss) },
          )
        : worstKind === "attack"
          ? tn(
              w.costly,
              "Your targets cost you most: {n} attack gave up about {vp} VP. Finish off a unit you've hurt before starting on a fresh one.",
              "Your targets cost you most: {n} attacks gave up about {vp} VP between them. Finish off a unit you've hurt before starting on a fresh one.",
              { vp: vp(w.loss) },
            )
          : worstKind === "stratagem"
            ? t("Your stratagems cost about {vp} VP: save them for the attack that needs them.", {
                vp: vp(w.loss),
              })
            : t("Your choices gave up about {vp} VP over the game.", { vp: vp(w.loss) });
    out.push({ weight: w.loss, text });
  }
  const missed = mine.filter((d) => !d.played);
  if (missed.length) {
    const lost = missed.reduce((a, d) => a + d.loss, 0);
    out.push({
      weight: lost,
      text: tn(
        missed.length,
        "You ended {n} phase with something still worth doing (about {vp} VP). Check every unit before pressing ▶.",
        "You ended {n} phases with something still worth doing (about {vp} VP). Check every unit before pressing ▶.",
        { vp: vp(lost) },
      ),
    });
  }
  const luck = review.totals[seat]?.luck ?? 0;
  if (Math.abs(luck) >= 0.08 * army)
    out.push({
      weight: Math.abs(luck) * 0.8,
      text:
        luck > 0
          ? t("Your dice ran hot: about {vp} VP above the average. Don't count on that next time.", {
              vp: vp(luck),
            })
          : t("Your dice ran cold: about {vp} VP below the average. The choices matter more than that.", {
              vp: vp(luck),
            }),
    });
  const strong = review.marks
    .filter((m) => m.kind === "strong" && review.decisions[m.decision]!.seat === seat)
    .sort((a, b) => b.size - a.size)[0];
  if (strong) {
    const d = review.decisions[strong.decision]!;
    out.push({
      weight: strong.size * 0.9,
      text: t(
        "Your best call: {move} in round {round}, about {n}% more chance to win than anything else on offer.",
        {
          move: moveText(states(d.seq), d.played),
          round: d.round,
          n: winShare(review, strong),
        },
      ),
    });
  }
  const costly = review.marks
    .filter((m) => m.kind === "costly" && review.decisions[m.decision]!.seat === seat)
    .sort((a, b) => b.size - a.size)[0];
  if (costly) {
    const d = review.decisions[costly.decision]!;
    const st = states(d.seq);
    out.push({
      weight: costly.size * 0.7,
      text: t(
        "The costliest call: {move} in round {round}. {better} was worth about {n}% more chance to win.",
        {
          move: moveText(st, d.played),
          round: d.round,
          better: capital(moveText(st, d.best)),
          n: winShare(review, costly),
        },
      ),
    });
  }
  if (out.length < 3) {
    const judged = mine.filter((d) => d.played).length;
    const clean = mine.filter((d) => d.played && d.loss < 0.02 * army).length;
    if (judged)
      out.push({
        weight: 0,
        text: t("{clean} of your {n} choices were as good as the best on offer.", { clean, n: judged }),
      });
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((x) => x.text);
}

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
