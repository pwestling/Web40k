import { getCached } from "../assets/cache";
import { unitKeys, useAssets } from "../assets/store";
import type { Model, ModelFigure, UnitId } from "../core";
import { useStore } from "../store";

/** A library model, loaded into this page. */
async function libraryAsset(id: string) {
  const here = useAssets.getState().assets[id];
  if (here) return here;
  const cached = await getCached(id);
  if (cached) useAssets.getState().addAsset(cached);
  return cached ?? null;
}

/**
 * Dress a unit's models (those in `keys`, or all of them) in a library
 * figure, for everyone in the game. Peers fetch the meshes as for an upload.
 */
export async function dressFromLibrary(unitId: UnitId, id: string, keys?: string[]): Promise<boolean> {
  const asset = await libraryAsset(id);
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  if (!asset || !unit) return false;
  const models = unit.modelIds.map((m) => game.models[m]).filter((m): m is Model => !!m);
  const figure: ModelFigure = { asset: asset.id, name: asset.name, yaw: 0, scale: 1 };
  dispatch(
    { type: "unit/figure", id: unitId, keys: keys ?? unitKeys(models), figure, bands: asset.figure?.bands },
    unit.owner,
  );
  return true;
}
