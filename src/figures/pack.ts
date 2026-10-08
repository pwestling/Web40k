import { getCached, putCached } from "../assets/cache";
import { decodeAsset, encodeAsset } from "../assets/codec";
import { fromBase64, toBase64 } from "../assets/base64";
import { useAssets } from "../assets/store";
import type { AssetKind } from "../assets/types";
import { stableJson } from "../core/secrets";
import { useFigures, type FigureEntry } from "./library";

/**
 * A figure pack: a club's collection in one file. Each figure carries its
 * processed meshes and paint (the same compressed form peers send each other),
 * its name, tags and the units it dresses, so suggestions work on the next
 * device too. The pack's hash covers every figure, so two players can tell
 * they hold the same pack, and a pack changed since it was made says so.
 */
export const PACK_FORMAT = "open-battle/figures@1";

export interface PackFigure {
  id: string;
  name: string;
  kind: AssetKind;
  tags: string[];
  units: string[];
  thumb?: string;
  /** The processed asset, encoded (src/assets/codec.ts), base64. */
  data: string;
}

export interface FigurePack {
  format: typeof PACK_FORMAT;
  name: string;
  savedAt: number;
  figures: PackFigure[];
  /** Hex SHA-256 of the figures (stableJson), sorted by id. */
  hash: string;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const packHash = (figures: PackFigure[]) =>
  sha256(stableJson([...figures].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))));

/** A short form of a pack's hash, to compare by eye. */
export const shortHash = (hash: string) => hash.slice(0, 8);

/** Make a pack of library entries; models no longer on this device are left out. */
export async function makePack(name: string, entries: FigureEntry[]): Promise<FigurePack> {
  const figures: PackFigure[] = [];
  for (const e of entries) {
    const asset = useAssets.getState().assets[e.id] ?? (await getCached(e.id));
    if (!asset) continue;
    figures.push({
      id: e.id,
      name: e.name,
      kind: e.kind,
      tags: e.tags,
      units: e.units,
      ...(e.thumb ? { thumb: e.thumb } : {}),
      data: toBase64(await encodeAsset(asset)),
    });
  }
  return { format: PACK_FORMAT, name, savedAt: Date.now(), figures, hash: await packHash(figures) };
}

export const packFileName = (pack: FigurePack) =>
  `${
    pack.name
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "figures"
  }.figures.json`;

export interface PackResult {
  name: string;
  hash: string;
  added: number;
  already: number;
  damaged: number;
  /** The pack's contents don't match its hash: something changed it after it was made. */
  changed: boolean;
}

/** Read a pack into the library. Names and tags the player already gave a figure are kept. */
export async function openPack(text: string): Promise<PackResult | string> {
  let pack: Partial<FigurePack>;
  try {
    pack = JSON.parse(text) as Partial<FigurePack>;
  } catch {
    return "That isn't a figure pack (it doesn't read as JSON).";
  }
  if (pack?.format !== PACK_FORMAT || !Array.isArray(pack.figures)) return "That isn't a figure pack.";
  const figures = pack.figures.filter(
    (f): f is PackFigure => !!f && /^[0-9a-f]{64}$/.test(f.id) && typeof f.data === "string",
  );
  const hash = await packHash(figures);
  const result: PackResult = {
    name: typeof pack.name === "string" ? pack.name : "Figure pack",
    hash,
    added: 0,
    already: 0,
    damaged: 0,
    changed: hash !== pack.hash || figures.length !== pack.figures.length,
  };
  const library = useFigures.getState();
  await library.load();
  for (const f of figures) {
    if (library.entries[f.id] || useAssets.getState().assets[f.id]) {
      result.already++;
      continue;
    }
    try {
      const asset = { ...(await decodeAsset(fromBase64(f.data))), id: f.id };
      await putCached(asset);
      useAssets.getState().addAsset(asset);
      useFigures.getState().note(asset);
      useFigures.getState().patch(f.id, {
        name: String(f.name || asset.name).slice(0, 80),
        tags: (Array.isArray(f.tags) ? f.tags : []).map(String).slice(0, 20),
        units: (Array.isArray(f.units) ? f.units : []).map(String).slice(0, 40),
        ...(typeof f.thumb === "string" && f.thumb.startsWith("data:image/") ? { thumb: f.thumb } : {}),
      });
      result.added++;
    } catch {
      result.damaged++;
    }
  }
  return result;
}
