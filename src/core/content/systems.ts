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
  if (!s) return placeholder(id);
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

export function unregisterSystem(id: Id): void {
  systems.delete(id);
}

const placeholders = new Map<Id, GameSystem>();

/**
 * A system that comes from a rules package not loaded here (yet, or by
 * choice): an empty stand-in, so the table still shows and the log still
 * folds while the package arrives. The lobby doesn't list it.
 */
function placeholder(id: Id): GameSystem {
  let s = placeholders.get(id);
  if (!s) {
    s = {
      id,
      name: `${id} (its rules package isn't loaded)`,
      version: "0",
      units: "inch",
      dice: [{ id: "d6", sides: 6 }],
      defaultDie: "d6",
      characteristics: [],
      weaponKinds: [],
      unitShape: { kind: "skirmish" },
      rules: [],
      procedures: [],
      actions: [],
      turn: {
        rounds: 5,
        round: [{ kind: "playerTurns", segments: [{ kind: "phase", id: "turn", name: "Turn" }] }],
      },
    };
    placeholders.set(id, s);
  }
  return s;
}

/** Whether a system id is only a stand-in (its package isn't loaded). */
export function isPlaceholder(id: Id): boolean {
  return !systems.has(id);
}
