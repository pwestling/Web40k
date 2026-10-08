import { create } from "zustand";
import type { DiceSet, GameState, ModelFigure, PlayerId } from "../core";
import type { ImportedRoster } from "../systems/wh40k/roster";

/**
 * The army shelf (roadmap #27): armies a player imported once, kept on this
 * device for later games. An army is its roster as the player checked it
 * (bases, frontages, filled-in stats), the names its units went by, the
 * figures dressing them, and the player's dice and side colour. Players can
 * pass one on as a file, figures included.
 */

export const ARMY_FORMAT = "open-battle/army@1";

/** A figure on a unit's models; its sight shape comes from the asset when it's put back. */
export interface ShelfFigure {
  figure: ModelFigure;
}

export interface SavedArmy {
  format: typeof ARMY_FORMAT;
  id: string;
  name: string;
  /** The game system it's for. */
  system: string;
  savedAt: number;
  roster: ImportedRoster;
  /** Figures by unit (index in `roster.units`), then by model profile ("Line Trooper"). */
  figures: Record<number, Record<string, ShelfFigure>>;
  dice?: DiceSet | null;
  color?: string;
}

/** An army as a file: the army plus its figures' processed assets (base64, by id). */
export interface ArmyFile extends SavedArmy {
  attachments?: { assets?: Record<string, string> };
}

const DB = "open-battle-shelf";
const STORE = "armies";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function all(): Promise<SavedArmy[]> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as SavedArmy[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function write(op: (store: IDBObjectStore) => void): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private mode or storage full: the army stays on the shelf until the page closes.
  }
}

interface Shelf {
  loaded: boolean;
  armies: Record<string, SavedArmy>;
  load(): Promise<void>;
  put(army: SavedArmy): void;
  remove(id: string): void;
}

export const useShelf = create<Shelf>((set, get) => ({
  loaded: false,
  armies: {},
  async load() {
    if (get().loaded) return;
    const armies = await all();
    set((s) => ({
      loaded: true,
      armies: { ...Object.fromEntries(armies.map((a) => [a.id, a])), ...s.armies },
    }));
  },
  put(army) {
    set((s) => ({ armies: { ...s.armies, [army.id]: army } }));
    void write((store) => store.put(army));
  },
  remove(id) {
    set((s) => {
      const { [id]: _gone, ...armies } = s.armies;
      return { armies };
    });
    void write((store) => store.delete(id));
  },
}));

/** The index of a spawned unit in its roster, from its id (`<prefix>-<index>`, see spawnIntents). */
const indexOf = (unitId: string, prefix: string): number | null => {
  if (!unitId.startsWith(`${prefix}-`)) return null;
  const n = Number(unitId.slice(prefix.length + 1));
  return Number.isInteger(n) ? n : null;
};

/**
 * An army as it stands in a game: the roster it was deployed from, with each
 * unit's current name and figures, and the player's dice and colour.
 */
export function armyFromGame(
  game: GameState,
  owner: PlayerId,
  deployed: { roster: ImportedRoster; prefix: string },
  id: string = crypto.randomUUID(),
): SavedArmy {
  const units = deployed.roster.units.map((u) => ({ ...u }));
  const figures: SavedArmy["figures"] = {};
  for (const unit of Object.values(game.units)) {
    if (unit.owner !== owner) continue;
    const i = indexOf(unit.id, deployed.prefix);
    if (i === null || !units[i]) continue;
    units[i] = { ...units[i]!, name: unit.name };
    for (const mid of unit.modelIds) {
      const m = game.models[mid];
      if (!m?.figure) continue;
      const key = m.profile?.name ?? m.label;
      (figures[i] ??= {})[key] = { figure: m.figure };
    }
  }
  const player = game.players[owner];
  return {
    format: ARMY_FORMAT,
    id,
    name: deployed.roster.name,
    system: game.system ?? "",
    savedAt: Date.now(),
    roster: { ...deployed.roster, units },
    figures,
    ...(player?.dice !== undefined ? { dice: player.dice } : {}),
    ...(player?.color ? { color: player.color } : {}),
  };
}

/** Every figure asset an army uses. */
export function armyAssets(army: SavedArmy): string[] {
  return [
    ...new Set(
      Object.values(army.figures).flatMap((byKey) => Object.values(byKey).map((f) => f.figure.asset)),
    ),
  ];
}

/** Whether a file's contents look like an army, and the army without its attachments. */
export function readArmy(data: unknown): SavedArmy | null {
  const a = data as Partial<ArmyFile> | null;
  if (
    !a ||
    a.format !== ARMY_FORMAT ||
    !a.roster ||
    !Array.isArray(a.roster.units) ||
    typeof a.name !== "string"
  )
    return null;
  const { attachments: _a, ...army } = a as ArmyFile;
  return {
    ...army,
    figures: army.figures ?? {},
    id: typeof army.id === "string" ? army.id : crypto.randomUUID(),
  };
}
