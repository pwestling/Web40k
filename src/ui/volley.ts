import { create } from "zustand";
import type { GameState } from "../core";
import { aliveModels, suggestAttack } from "../systems/wh40k/rules";
import { useStore } from "../store";
import { t } from "../i18n";

/**
 * "Shoot everything at…" (UX 398): a unit's ranged weapons, one attack each,
 * at one target, declared one after another as each attack is done.
 */
interface Volley {
  attackerId: string;
  targetId: string;
  /** The weapons still to fire, in order. */
  weapons: string[];
}

export const useVolley = create<{ queue: Volley | null }>(() => ({ queue: null }));

/**
 * The unit's ranged weapons against the target: those that can fire now (models in range and in
 * sight, not used this phase), and those that can't, with why.
 */
export function volleyWeapons(
  game: GameState,
  attackerId: string,
  targetId: string,
): { id: string; name: string; inRange: number; why?: string }[] {
  const attacker = game.units[attackerId];
  if (!attacker) return [];
  return Object.values(attacker.sheet?.weapons ?? {}).flatMap((w) => {
    if (w.kind !== "ranged") return [];
    const base = { id: w.id, name: w.name };
    if (attacker.status?.[`fired.${w.id}`]) return [{ ...base, inRange: 0, why: t("used this phase") }];
    const s = suggestAttack(game, attackerId, w.id, targetId);
    if (!s || s.inRange === 0) return [{ ...base, inRange: 0, why: t("out of range") }];
    if (s.visible === 0) return [{ ...base, inRange: s.inRange, why: t("can't see it") }];
    return [{ ...base, inRange: s.inRange }];
  });
}

/** Declare the next weapon's attack; the volley ends when none is left or the target is gone. */
export function fireNext(): void {
  const q = useVolley.getState().queue;
  if (!q) return;
  const { game, dispatch } = useStore.getState();
  const target = game.units[q.targetId];
  const attacker = game.units[q.attackerId];
  let rest = q.weapons;
  while (rest.length && attacker && target && aliveModels(game, target).length) {
    const [next, ...more] = rest;
    rest = more;
    const s = suggestAttack(game, q.attackerId, next!, q.targetId);
    if (!s || s.inRange === 0) continue;
    useVolley.setState({ queue: more.length ? { ...q, weapons: more } : null });
    dispatch({ type: "attack/declare", spec: s.spec }, attacker.owner);
    return;
  }
  useVolley.setState({ queue: null });
}

// When one weapon's attack is done (cleared), the next one's is declared.
useStore.subscribe((s, prev) => {
  if (
    prev.game.attack &&
    !s.game.attack &&
    !s.game.procedure &&
    s.scrub === null &&
    useVolley.getState().queue
  )
    window.setTimeout(fireNext, 0);
});
