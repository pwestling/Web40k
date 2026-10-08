import type { GameState, Unit } from "../core";
import { opposed } from "../core/teams";
import { systemOf } from "../core/content/turn";
import { gameModule } from "../systems";
import { t } from "../i18n";
import type { BotMove } from "../soak/bot";

/**
 * Why the computer made a move (#45), in one short line for the table:
 * "going for the East lantern", "charging the Warden-Captain". Worked out
 * from the move and the table, so it reads the same at every level and for
 * moves made in a package's sandbox. Null for moves that need no telling
 * (rolls, answers, moving the game on).
 */
interface Explained {
  unitId: string;
  text: string;
  /** Where a moving unit started and ended (centres). */
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

const centre = (state: GameState, u: Unit) => {
  const ms = u.modelIds.flatMap((id) =>
    state.models[id] && !state.models[id]!.destroyed ? [state.models[id]!] : [],
  );
  if (!ms.length) return null;
  return {
    x: ms.reduce((a, m) => a + m.position.x, 0) / ms.length,
    y: ms.reduce((a, m) => a + m.position.y, 0) / ms.length,
  };
};

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** An attack's line, by what kind of attack it is. */
function attackLine(id: string, name: string, target: string): string {
  if (/charge/i.test(id)) return t("charging {target}", { target });
  if (/shoot|fire|volley/i.test(id)) return t("shooting at {target}", { target });
  if (/fight|melee|strike|combat/i.test(id)) return t("fighting {target}", { target });
  return t("{action} at {target}", { action: name, target });
}

export function explain(state: GameState, move: BotMove): Explained | null {
  const i = move.intent;
  if (i.type === "action/take" && "targetId" in i && i.targetId) {
    const target = state.units[i.targetId]?.name;
    const def = systemOf(state).actions.find((a) => a.id === i.action);
    if (!target || !def) return null;
    return { unitId: i.unitId, text: attackLine(def.id, def.name, target) };
  }
  if (i.type === "script/start") {
    const unitId = typeof i.args?.unit === "string" ? i.args.unit : null;
    const targetId = typeof i.args?.target === "string" ? i.args.target : null;
    if (!unitId || !targetId) return null;
    const target = state.units[targetId]?.name;
    const action = gameModule(state.system)?.actions?.find((a) => a.id === i.procedure);
    if (!target) return null;
    return { unitId, text: attackLine(i.procedure, action?.name ?? i.procedure, target) };
  }
  const moved =
    i.type === "models/move" ? i : move.then?.intent.type === "models/move" ? move.then.intent : null;
  if (!moved || !moved.moves.length) return null;
  const unitId = state.models[moved.moves[0]!.id]?.unitId;
  const unit = unitId ? state.units[unitId] : undefined;
  if (!unit || !unitId) return null;
  const from = centre(state, unit);
  if (!from) return null;
  const to = {
    x: moved.moves.reduce((a, m) => a + m.to.x, 0) / moved.moves.length,
    y: moved.moves.reduce((a, m) => a + m.to.y, 0) / moved.moves.length,
  };
  const enemies = Object.values(state.units).flatMap((e) => {
    const c = opposed(state, e.owner, unit.owner) ? centre(state, e) : null;
    return c ? [{ e, c }] : [];
  });
  const nearest = (p: { x: number; y: number }) =>
    enemies.reduce<{ e: Unit; c: { x: number; y: number } } | null>(
      (best, x) => (!best || dist(x.c, p) < dist(best.c, p) ? x : best),
      null,
    );
  const objective = [...state.objectives].sort((a, b) => dist(a.position, to) - dist(b.position, to))[0];
  const line = (text: string): Explained => ({ unitId, text, from, to });
  // Charging into contact: the move ends against an enemy.
  const foe = nearest(to);
  const touching =
    foe &&
    moved.moves.some((m) =>
      foe.e.modelIds.some((id) => {
        const x = state.models[id];
        return x && !x.destroyed && dist(x.position, m.to) < 1.6;
      }),
    );
  if (touching) return line(t("charging {target}", { target: foe.e.name }));
  if (
    objective &&
    dist(objective.position, to) < 4 &&
    dist(objective.position, to) < dist(objective.position, from) - 0.5
  )
    return line(
      objective.label
        ? t("going for the {objective}", { objective: objective.label })
        : t("going for an objective"),
    );
  const near = nearest(from);
  if (near && dist(near.c, to) < dist(near.c, from) - 0.5)
    return line(t("closing on {target}", { target: near.e.name }));
  if (near && dist(near.c, to) > dist(near.c, from) + 0.5)
    return line(t("pulling back from {target}", { target: near.e.name }));
  return line(t("moving up"));
}
