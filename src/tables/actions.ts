import { fromBase64, toBase64 } from "../assets/base64";
import { getCached, putCached } from "../assets/cache";
import { useAssets } from "../assets/store";
import type { Layout } from "../core";
import { useStore } from "../store";
import { download } from "../ui/report";
import {
  layoutAssets,
  readTable,
  tableFromGame,
  useTables,
  type SavedTable,
  type TableFile,
} from "./library";

/** A terrain model, from this page or this device's cache. */
async function asset(id: string) {
  const here = useAssets.getState().assets[id];
  if (here) return here;
  const cached = await getCached(id);
  if (cached) useAssets.getState().addAsset(cached);
  return cached;
}

/** Put the table as it stands in the library; returns its id. */
export function saveTable(name: string, id?: string): string {
  const table = tableFromGame(useStore.getState().game, name.trim() || "My table", id);
  useTables.getState().put(table);
  return table.id;
}

/**
 * Set up a layout on the table. Its terrain models come out of this device's
 * cache first, so the other players can get them from here.
 */
export async function applyLayout(layout: Layout): Promise<void> {
  await Promise.all(layoutAssets(layout).map(asset));
  useStore.getState().dispatch({ type: "layout/set", layout });
}

const fileName = (name: string) =>
  `${
    name
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "table"
  }.table.json`;

/** Download a table as a file, with its terrain models, to pass on or keep. */
export async function exportTable(table: SavedTable): Promise<string> {
  const { encodeAsset } = await import("../assets/codec");
  const assets: Record<string, string> = {};
  for (const id of layoutAssets(table.layout)) {
    const a = await asset(id);
    if (a) assets[id] = toBase64(await encodeAsset(a));
  }
  const file: TableFile = { ...table, attachments: { assets } };
  return download(fileName(table.name), file);
}

/**
 * Read a table file into the library, its models into this device's cache.
 * An old loose layout file (open-battle/layout@1) comes in as a table for this game.
 */
export async function importTableFile(file: File): Promise<SavedTable | string> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return "That file isn't an Open Battle table.";
  }
  const loose = data as Partial<Layout> & { format?: string };
  if (loose?.format === "open-battle/layout@1" && Array.isArray(loose.terrain)) {
    const game = useStore.getState().game;
    const table: SavedTable = {
      ...tableFromGame(game, file.name.replace(/\.json$/i, "").replace(/[-_]+/g, " ")),
      layout: {
        terrain: loose.terrain,
        objectives: loose.objectives ?? game.objectives,
        zones: loose.zones ?? game.zones,
      },
    };
    useTables.getState().put(table);
    return table;
  }
  const table = readTable(data);
  if (!table) return "That file isn't an Open Battle table.";
  const attached = (data as TableFile).attachments?.assets ?? {};
  if (Object.keys(attached).length) {
    const { decodeAsset } = await import("../assets/codec");
    for (const [id, b64] of Object.entries(attached)) {
      if (!/^[0-9a-f]{64}$/.test(id) || useAssets.getState().assets[id]) continue;
      try {
        const a = { ...(await decodeAsset(fromBase64(b64))), id };
        useAssets.getState().addAsset(a);
        void putCached(a);
      } catch {
        // A damaged model: the piece keeps its plain stand-in shape.
      }
    }
  }
  useTables.getState().put(table);
  return table;
}
