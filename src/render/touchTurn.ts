import { aliveModels } from "../core";
import { blockFrame, isBlock, wheelMove } from "../core/regiment";
import { useStore } from "../store";

/** A twist's turn, to the nearest 15 degrees (radians). */
export const snapTurn = (angle: number) => (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;

/**
 * Set down a two-finger twist on a unit (#60): a regiment block wheels on a front corner, as The Old World
 * wheels; anything else turns where it stands (Full Spectrum Dominance facing). Clockwise on the screen is
 * clockwise on the table, as Q / E turn it.
 */
export function turnByTwist(unitId: string, angle: number): void {
  const turn = snapTurn(angle);
  if (!turn) return;
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  const alive = unit ? aliveModels(game, unit) : [];
  if (!unit || !alive.length) return;
  const frame = isBlock(unit) && alive.length > 1 ? blockFrame(game, unit) : null;
  if (frame) return dispatch(wheelMove(frame, unitId, turn), unit.owner);
  const pivot = {
    x: alive.reduce((a, m) => a + m.position.x, 0) / alive.length,
    y: alive.reduce((a, m) => a + m.position.y, 0) / alive.length,
  };
  dispatch({ type: "unit/move", id: unitId, pivot, turn, delta: { x: 0, y: 0 } }, unit.owner);
}
