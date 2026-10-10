import { create } from "zustand";
import { maxWounds } from "../core/attack";
import { aliveModels } from "../core/units";
import { t, tn } from "../i18n";
import { useStore } from "../store";

/**
 * TTS controls (PX TTS reflexes): an opt-in for players coming from Tabletop Simulator, kept on this device.
 * Left drag on the table draws a box that picks units, right drag turns the camera, WASD slides it and
 * holding Tab measures.
 */
const KEY = "open-battle:tts-controls";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const useTtsControls = create<{ on: boolean }>(() => ({ on: stored() }));

export function setTtsControls(on: boolean): void {
  useTtsControls.setState({ on });
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
}

/** The model under the pointer on the table, for Delete (set by the board). */
export const pointerModel: { id: string | null } = { id: null };

/** Whether this player may take these models off: theirs online, anyone's in hotseat. */
function removable(ids: string[]): string[] {
  const s = useStore.getState();
  if (s.role === "spectator" || s.scrub !== null) return [];
  return ids.filter((id) => {
    const m = s.game.models[id];
    return m && !m.destroyed && (s.mode === "hotseat" || m.owner === s.session?.selfId);
  });
}

/**
 * Delete, or a model dropped off the table: after asking, these models are removed as casualties, just as
 * losing their last wound does. Returns whether they were.
 */
export function removeAsCasualties(ids: string[]): boolean {
  const mine = removable(ids);
  if (!mine.length) return false;
  const ask =
    mine.length === 1
      ? t("Remove {model} as a casualty?", { model: useStore.getState().game.models[mine[0]!]!.label })
      : tn(mine.length, "Remove {n} model as a casualty?", "Remove {n} models as casualties?");
  if (!confirm(ask)) return false;
  const { game, dispatch } = useStore.getState();
  for (const id of mine) {
    const m = game.models[id]!;
    dispatch({ type: "model/wounds", id, woundsLost: maxWounds(m), destroyed: true }, m.owner);
  }
  return true;
}

/** Delete on the table: the model under the pointer, else the selected unit's last model standing. */
export function deleteKey(): boolean {
  const { game, selected } = useStore.getState();
  const hovered = pointerModel.id ? game.models[pointerModel.id] : undefined;
  if (hovered && !hovered.destroyed) return removeAsCasualties([hovered.id]);
  const unit = selected ? game.units[selected] : undefined;
  if (!unit) return false;
  const last = aliveModels(game, unit).at(-1);
  return last ? removeAsCasualties([last.id]) : false;
}
