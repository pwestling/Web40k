import { create } from "zustand";
import { unitKeys } from "../assets/store";
import type { GameState, PlayerId, UnitId } from "../core";
import { useStore } from "../store";

/**
 * "Photograph your painted figures" from the army (UX 471): the player's
 * first unit still in its stand-in is selected, and its card opens the
 * standee maker.
 */
export const usePhotoAsk = create<{ unit: UnitId | null }>(() => ({ unit: null }));

/** The owner's units that have no figure yet, in table order. */
export function undressed(game: GameState, owner: PlayerId): UnitId[] {
  return Object.values(game.units)
    .filter((u) => u.owner === owner)
    .filter((u) => {
      const models = u.modelIds.map((id) => game.models[id]).filter((m) => m && !m.destroyed);
      return models.length > 0 && unitKeys(models as never).length > 0 && models.every((m) => !m!.figure);
    })
    .map((u) => u.id);
}

export function photographNext(owner: PlayerId): void {
  const unit = undressed(useStore.getState().game, owner)[0];
  if (!unit) return;
  useStore.getState().select(unit);
  usePhotoAsk.setState({ unit });
}
