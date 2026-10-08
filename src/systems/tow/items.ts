import type { Ability, GameState, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, GameView } from "../../sdk";
import { ITEM_GROUP } from "./roster";

/**
 * Magic items (The Old World): the roster brings each item in as an ability
 * under "Magic items and options", its text the player's own. A unit uses one
 * from its card in any phase; the log says so, and an item whose text says it
 * works once ("one use only", "single use", "once per game") is spent and not
 * offered again, and any item is used at most once a phase. What the item does stays with the players.
 */

/** Unit status key marking an item spent. */
export const spentKey = (item: string) => `spent.${item}`;

/** Whether the item's text says it works once. */
export const oneUse = (a: Ability) => /one use|single use|once per (game|battle)/i.test(a.text);

/** A points-only option ("10 pts"): wargear, not an item to use. */
const pointsOnly = (a: Ability) => /^\s*\d+\s*pts?\.?\s*$/i.test(a.text);

/** This phase's marker: an item is used at most once a phase. */
const phaseMark = (view: GameView) => {
  const now = view.state.turn;
  return `${now.round}:${now.activeSeat}:${view.phase ?? ""}`;
};
const usedNow = (view: GameView, u: Unit) => {
  const used = view.own[`items:${u.id}`] as { at: string; names: string[] } | undefined;
  return used?.at === phaseMark(view) ? used.names : [];
};

/** The unit's items it can still use: in the items group, with rules text, not spent, not used this phase. */
export function usableItems(view: GameView, u: Unit | undefined): Ability[] {
  if (!u) return [];
  const now = usedNow(view, u);
  return (u.sheet?.abilities ?? []).filter(
    (a) => a.group === ITEM_GROUP && !pointsOnly(a) && !u.status?.[spentKey(a.name)] && !now.includes(a.name),
  );
}

const alive = (state: GameState, u: Unit) =>
  u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);

const useItem: CodeProcedure = function* (ctx, args) {
  const u = ctx.view.state.units[String(args.unit ?? "")];
  const items = usableItems(ctx.view, u);
  if (!u || !items.length) return;
  const name =
    items.length === 1
      ? items[0]!.name
      : ((yield ctx.ask(
          u.owner,
          `Which magic item does ${u.name} use?`,
          items.map((a) => ({ id: a.name, label: a.name })),
        )) as string);
  const item = items.find((a) => a.name === name) ?? items[0]!;
  yield ctx.set(`items:${u.id}`, { at: phaseMark(ctx.view), names: [...usedNow(ctx.view, u), item.name] });
  if (oneUse(item)) {
    yield ctx.emit({ type: "unit/status", id: u.id, key: spentKey(item.name), value: true });
    yield ctx.note(`${u.name} uses ${item.name} (one use: now spent)`);
  } else yield ctx.note(`${u.name} uses ${item.name}`);
};

export const itemActions: CodeAction[] = [
  {
    id: "useItem",
    name: "Use a magic item",
    by: "unit",
    applies: (view: GameView, actor) =>
      (view.state.units[actor.unitId ?? ""]?.sheet?.abilities ?? []).some((a) => a.group === ITEM_GROUP),
    // The item by name when there's one to use (UX 322).
    label: (view, actor) => {
      const items = usableItems(view, view.state.units[actor.unitId ?? ""]);
      return items.length === 1
        ? `Use ${items[0]!.name}${oneUse(items[0]!) ? " (one use)" : ""}`
        : "Use a magic item";
    },
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u || !alive(view.state, u)) return "The unit is gone";
      if (usableItems(view, u).length) return true;
      const items = (u.sheet?.abilities ?? []).filter((a) => a.group === ITEM_GROUP && !pointsOnly(a));
      const spent = items.filter((a) => u.status?.[spentKey(a.name)]).map((a) => a.name);
      const used = items.filter((a) => !spent.includes(a.name)).map((a) => a.name);
      if (!used.length) return `${spent.join(", ")} ${spent.length > 1 ? "are" : "is"} spent`;
      return `${used.join(", ")} ${used.length > 1 ? "were" : "was"} used this phase`;
    },
    run: useItem,
  },
];
