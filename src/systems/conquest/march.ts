import { blockFrame } from "../../core/regiment";
import { lookAlong } from "../../core/manoeuvre";
import { isAlive } from "../../core/units";
import type { GameState, Unit } from "../../core/types";
import type { GameView, Warning } from "../../sdk";

/**
 * March limits (research/conquest-rules.md, Actions), advisory: moving
 * sideways or backwards costs double (half rate), and a march can't end
 * within 1" of an enemy. Checked for the regiment whose activation is under
 * way, once it has marched (the "marched" flag) and not charged.
 */

const EPS = 0.05;
const NEAR = 1;

const standing = (state: GameState, u: Unit) =>
  u.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [m] : [];
  });

/**
 * How far the regiment went this activation, split by its facing: forwards,
 * and sideways or backwards. Null when it turned or wheeled (the split means
 * nothing then; the move distance check still measures it) or has no start.
 */
function marchSplit(state: GameState, unit: Unit): { forward: number; other: number } | null {
  const ms = standing(state, unit);
  if (!ms.length || ms.some((m) => !m.phaseStart)) return null;
  // A turn shows as the line between two stands pointing another way than at the start.
  if (ms.length > 1) {
    const [a, b] = [ms[0]!, ms[ms.length - 1]!];
    const then = Math.atan2(b.phaseStart!.y - a.phaseStart!.y, b.phaseStart!.x - a.phaseStart!.x);
    const now = Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x);
    let turn = Math.abs(now - then) % (Math.PI * 2);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn > 0.05) return null;
  }
  const facing = blockFrame(state, unit)?.facing ?? ms[0]!.facing;
  const ahead = lookAlong(facing);
  let dx = 0;
  let dy = 0;
  for (const m of ms) {
    dx += m.position.x - m.phaseStart!.x;
    dy += m.position.y - m.phaseStart!.y;
  }
  dx /= ms.length;
  dy /= ms.length;
  const along = dx * ahead.x + dy * ahead.y;
  const across = Math.abs(dx * ahead.y - dy * ahead.x);
  return { forward: Math.max(0, along), other: across + Math.max(0, -along) };
}

const inches = (n: number) => `${Math.round(n * 10) / 10}"`;

export function marchWarnings(view: GameView): Warning[] {
  if (view.atTable || view.round === 0) return [];
  const state = view.state;
  const out: Warning[] = [];
  for (const unit of Object.values(state.units)) {
    const st = unit.status ?? {};
    if (!st.acting || !st.marched || st.charged || !isAlive(state, unit)) continue;
    const allowed = Number(st.allowance ?? 0);
    const split = marchSplit(state, unit);
    if (split && split.other > EPS) {
      const cost = split.forward + split.other * 2;
      if (cost > allowed + EPS)
        out.push({
          id: "marchRate",
          unitId: unit.id,
          message: `${unit.name}: sideways or backwards is half rate, so this march counts as ${inches(cost)} of ${inches(allowed)}`,
        });
    }
    const near = Object.values(state.units).find(
      (u) =>
        u.owner !== unit.owner &&
        !u.status?.reserves &&
        isAlive(state, u) &&
        view.distance(unit.id, u.id) < NEAR - 1e-4,
    );
    if (near)
      out.push({
        id: "marchNearEnemy",
        unitId: unit.id,
        message: `${unit.name}: a march can't end within 1" of an enemy (${near.name})`,
      });
  }
  return out;
}
