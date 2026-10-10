import { create } from "zustand";
import type { GameState, Layout, TerrainPiece, Zone } from "../core";
import { idbStore } from "../packages/idb";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { cleanDecks } from "../core/cards";
import { t, tn } from "../i18n";

/**
 * The table library (roadmap #28): layouts saved on this device beside the
 * army shelf, each with its game system, table size, deployment zones,
 * objectives and terrain (uploaded terrain models by asset id). A host picks
 * one before the battle; its models travel to the other players as figures
 * do. Passed on as a file, models included.
 */

export const TABLE_FORMAT = "open-battle/table@1";

export interface SavedTable {
  format: typeof TABLE_FORMAT;
  id: string;
  name: string;
  system: string;
  savedAt: number;
  table: { width: number; depth: number };
  layout: Layout;
}

/** A table as a file: the table plus its terrain models' processed assets (base64, by id). */
export interface TableFile extends SavedTable {
  attachments?: { assets?: Record<string, string> };
}

const db = idbStore<SavedTable>("open-battle-tables", "tables");

interface Library {
  loaded: boolean;
  tables: Record<string, SavedTable>;
  load(): Promise<void>;
  put(table: SavedTable): void;
  remove(id: string): void;
}

export const useTables = create<Library>((set, get) => ({
  loaded: false,
  tables: {},
  async load() {
    if (get().loaded) return;
    const all = await db.all();
    set((s) => ({ loaded: true, tables: { ...Object.fromEntries(all.map((t) => [t.id, t])), ...s.tables } }));
  },
  put(table) {
    set((s) => ({ tables: { ...s.tables, [table.id]: table } }));
    void db.put(table);
  },
  remove(id) {
    set((s) => {
      const { [id]: _gone, ...tables } = s.tables;
      return { tables };
    });
    void db.remove(id);
  },
}));

/** The table as it stands in a game, to save. */
export function tableFromGame(game: GameState, name: string, id: string = crypto.randomUUID()): SavedTable {
  return {
    format: TABLE_FORMAT,
    id,
    name,
    system: game.system ?? DEFAULT_SYSTEM,
    savedAt: Date.now(),
    table: { width: game.table.width, depth: game.table.depth },
    layout: {
      terrain: game.terrain,
      objectives: game.objectives,
      zones: game.zones,
      ...(game.decks?.length ? { decks: game.decks } : {}),
    },
  };
}

/** Every uploaded terrain model a layout uses. */
export function layoutAssets(layout: Layout): string[] {
  return [...new Set(layout.terrain.flatMap((t) => (t.mesh ? [t.mesh.asset] : [])))];
}

/** "2 terrain models: Hab block, Gantry", or "" when it uses none. */
export function modelsLine(layout: Layout): string {
  const names = [
    ...new Set(layout.terrain.flatMap((t) => (t.mesh ? [t.mesh.name.replace(/\.[^.]+$/, "")] : []))),
  ];
  if (!names.length) return "";
  return tn(names.length, "{n} terrain model: {names}", "{n} terrain models: {names}", {
    names: names.join(", "),
  });
}

/** How the sides deploy, in a few words: "Long edges", "Short edges", "No zones" or "Custom zones". */
export function deploymentLine(zones: Zone[], table: { width: number; depth: number }): string {
  if (!zones.length) return t("No zones");
  const spans = zones.map((z) => {
    const xs = z.points.map((p) => p.x);
    const ys = z.points.map((p) => p.y);
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
  });
  if (zones.length === 2 && spans.every((s) => s.w >= table.width - 0.1))
    return t('Long edges ({depth}")', { depth: Math.round(spans[0]!.d) });
  if (zones.length === 2 && spans.every((s) => s.d >= table.depth - 0.1))
    return t('Short edges ({width}")', { width: Math.round(spans[0]!.w) });
  return t("Custom zones");
}

/** Whether a file's contents look like a table, without its attachments. */
export function readTable(data: unknown): SavedTable | null {
  const t = data as Partial<TableFile> | null;
  const layout = t?.layout;
  if (
    !t ||
    t.format !== TABLE_FORMAT ||
    typeof t.name !== "string" ||
    !layout ||
    !Array.isArray(layout.terrain) ||
    !t.table ||
    !(t.table.width > 0) ||
    !(t.table.depth > 0)
  )
    return null;
  const { attachments: _a, ...table } = t as TableFile;
  return {
    ...table,
    id: typeof table.id === "string" ? table.id : crypto.randomUUID(),
    system: typeof table.system === "string" ? table.system : "",
    savedAt: typeof table.savedAt === "number" ? table.savedAt : Date.now(),
    layout: {
      terrain: layout.terrain as TerrainPiece[],
      objectives: Array.isArray(layout.objectives) ? layout.objectives : [],
      zones: Array.isArray(layout.zones) ? layout.zones : [],
      ...(Array.isArray(layout.decks) ? { decks: cleanDecks(layout.decks) } : {}),
    },
  };
}
