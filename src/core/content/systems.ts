import { fortyK } from "./examples/forty-k";
import { fsd } from "./examples/fsd";
import type { GameSystem, Id } from "./schema";

/**
 * Game systems the engine can run. 40k and Full Spectrum Dominance are built
 * in; others register at startup or when a player imports one.
 */
const systems = new Map<Id, GameSystem>([
  [fortyK.id, fortyK],
  [fsd.id, fsd],
]);

/** Every registered system, for the lobby's picker. */
export function listSystems(): GameSystem[] {
  return [...systems.values()];
}

export function registerSystem(system: GameSystem): void {
  systems.set(system.id, system);
}

export function getSystem(id: Id): GameSystem {
  const s = systems.get(id);
  if (!s) throw new Error(`Unknown game system "${id}"`);
  return s;
}

/** What a rules package adds to a system as data (sdk PackageContents, minus its code). */
export interface SystemAdditions {
  rules?: GameSystem["rules"];
  actions?: GameSystem["actions"];
  abilityTimings?: GameSystem["abilityTimings"];
}

/** Systems as they were before packages extended them, to put back. */
const bases = new Map<Id, GameSystem>();

/** Add a package's rules, data actions and ability timings to a registered system. */
export function extendSystem(id: Id, add: SystemAdditions): void {
  const s = systems.get(id);
  if (!s) return;
  if (!bases.has(id)) bases.set(id, s);
  const merge = <T extends { id: Id }>(base: T[] | undefined, more: T[] | undefined) =>
    more?.length ? [...(base ?? []).filter((x) => !more.some((m) => m.id === x.id)), ...more] : base;
  systems.set(id, {
    ...s,
    rules: merge(s.rules, add.rules) ?? [],
    actions: merge(s.actions, add.actions) ?? [],
    ...(add.abilityTimings?.length
      ? { abilityTimings: [...(s.abilityTimings ?? []), ...add.abilityTimings] }
      : {}),
  });
}

/** Undo every package's additions (the game stopped using them). */
export function restoreSystems(): void {
  for (const [id, base] of bases) systems.set(id, base);
  bases.clear();
}
