import type { AbilityAuto, Army, ArmyStratagem, PlayerId } from "../core";
import { useStore } from "../store";
import { stratagemId } from "../systems/wh40k/roster";
import { saveToShelf, useDeployed } from "./shelfActions";
import type { StratagemSettings } from "./TeachRule";

/**
 * Where a taught rule (#53) goes: on the units that have the ability, on the
 * army's rules, or on its stratagems; then onto the army in the shelf, so the
 * next game starts with it.
 */

/** Once the table has the change, the army on the shelf gets it too (when it came from the shelf or was saved there). */
function keepOnShelf(owner: PlayerId) {
  if (!useDeployed.getState()[owner]?.shelfId) return;
  const before = useStore.getState().game;
  const save = () => {
    stop();
    clearTimeout(timer);
    saveToShelf(owner);
  };
  const stop = useStore.subscribe((s) => s.game !== before && save());
  const timer = setTimeout(save, 3000);
}

/** Every unit of the player's with this ability runs it: the same rule, the same name. */
export function teachAbility(owner: PlayerId, ability: string, auto: AbilityAuto | null) {
  const { game, dispatch } = useStore.getState();
  keepOnShelf(owner);
  for (const unit of Object.values(game.units))
    if (unit.owner === owner && unit.sheet?.abilities.some((a) => a.name === ability))
      dispatch({ type: "unit/automate", id: unit.id, ability, auto }, owner);
}

function setArmy(owner: PlayerId, change: (army: Army) => Army) {
  const { game, dispatch } = useStore.getState();
  keepOnShelf(owner);
  dispatch(
    { type: "player/army", army: change(game.armies?.[owner] ?? { rules: [], stratagems: [] }) },
    owner,
  );
}

/** A detachment or army rule: it runs for every unit of the army. */
export function teachArmyRule(owner: PlayerId, rule: string, auto: AbilityAuto | null) {
  setArmy(owner, (army) => ({
    ...army,
    rules: army.rules.map((r) => {
      if (r.name !== rule) return r;
      const { auto: _, ...rest } = r;
      return auto ? { ...rest, auto } : rest;
    }),
  }));
}

/** A stratagem, changed or new: a taught one picks a unit and runs on it for the phase. */
export function teachStratagem(
  owner: PlayerId,
  id: string | null,
  settings: StratagemSettings,
  auto: AbilityAuto | null,
) {
  setArmy(owner, (army) => {
    const old = id ? army.stratagems.find((s) => s.id === id) : undefined;
    const base: ArmyStratagem = old ?? {
      id: stratagemId(settings.name.trim(), new Set(army.stratagems.map((s) => s.id))),
      name: settings.name.trim(),
      cp: 1,
      side: "either",
      text: "",
    };
    const { auto: _a, phases: _p, once: _o, targetKeywords: _k, ...rest } = base;
    const next: ArmyStratagem = {
      ...rest,
      cp: settings.cp,
      side: settings.side,
      ...(settings.phases?.length ? { phases: settings.phases } : {}),
      ...(settings.targetKeywords?.trim() ? { targetKeywords: settings.targetKeywords.trim() } : {}),
      ...(settings.once && settings.once !== "phase" ? { once: settings.once } : {}),
      ...(auto ? { auto, targetsUnit: true } : {}),
    };
    return {
      ...army,
      stratagems: old ? army.stratagems.map((s) => (s === old ? next : s)) : [...army.stratagems, next],
    };
  });
}
