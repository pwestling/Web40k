import { useAssets } from "../assets/store";
import type { AssetKind, ModelAsset } from "../assets/types";
import { systemOf } from "../core/content/turn";
import { downloadUrl, type TtsFolder } from "../figures/tts";
import { useFigures } from "../figures/library";
import { t } from "../i18n";
import { ARMY_FORMAT, useShelf, type SavedArmy } from "../packages/shelf";
import { systemModule } from "../systems";
import { makePiece } from "../systems/wh40k/layout";
import { TABLE_FORMAT, useTables, type SavedTable } from "../tables/library";
import { meshShape } from "../tables/meshShape";
import { ttsArmies, type TtsAsset } from "./armies";
import { armyMiddle, objCentre, placeOnTable, turnTable, type TtsTable, type TtsThing } from "./table";

/**
 * Bring a TTS table over (#73): its models into the figure library (as #71
 * does), its terrain as a table in the table library, where TTS had it, and
 * the armies standing on it as shelf armies.
 */

/** One model to import: what the figure library's TTS import and the whole-table import share. */
interface TtsModelIn {
  key: string;
  name: string;
  mesh: string;
  diffuse?: string;
  scale: number;
  kind: AssetKind;
  /** Names army units know it by, for the library's matching. */
  names: string[];
  description?: string;
}

type ImportOutcome = { asset: ModelAsset; centre: [number, number, number] } | "missing" | "failed";

/** Fetch a model's files (the TTS folder first), run them through the pipeline, and note it in the library. */
export async function importTtsModel(
  m: TtsModelIn,
  folder: TtsFolder | null,
  title: string,
): Promise<ImportOutcome> {
  const mesh = folder?.find(m.mesh, "model") ?? (await download(m.mesh));
  if (!mesh) return "missing";
  const texture = m.diffuse ? (folder?.find(m.diffuse, "image") ?? (await download(m.diffuse))) : undefined;
  const centre = objCentre(await mesh.text());
  const asset = await useAssets
    .getState()
    .importFile(new File([mesh], `${m.name}.obj`), `library:tts:${m.key}`, m.kind, {
      ...(texture ? { texture } : {}),
      unitScale: m.scale,
    });
  if (!asset) return "failed";
  // TTS's own names let army units find the figure by name; no picture matching needed.
  const { entries, patch } = useFigures.getState();
  const entry = entries[asset.id];
  patch(asset.id, {
    tags: [...new Set([...(entry?.tags ?? []), "tts", title.toLowerCase()])],
    units: [...new Set([...(entry?.units ?? []), ...m.names])].slice(0, 40),
    ...(m.description && !entry?.description ? { description: m.description } : {}),
  });
  return { asset, centre };
}

/** A file from the web, if its host lets this page have it. */
async function download(url: string): Promise<Blob | undefined> {
  try {
    const r = await fetch(downloadUrl(url));
    return r.ok ? await r.blob() : undefined;
  } catch {
    return undefined;
  }
}

/** A table mat: a board model or anything this wide and this flat. Its size, not a piece of terrain. */
const MAT_ACROSS = 24;
const MAT_HEIGHT = 1.5;

export interface BroughtTable {
  table: SavedTable;
  /** Each with the half of the table it stood on (0: the near, +y half). */
  armies: { side: 0 | 1; army: SavedArmy }[];
  /** Models that weren't in the TTS folder and couldn't be downloaded, or couldn't be read. */
  missing: number;
  failed: number;
  /** The names of models that didn't come: figures stay as stand-ins, terrain is left out (UX 475). */
  lost: string[];
  /** Pieces standing off this game's table. */
  off: number;
}

export async function bringTable(
  scan: TtsTable,
  system: string,
  folder: TtsFolder | null,
  progress: (line: string) => void,
): Promise<BroughtTable> {
  // Every model once, terrain or figure as the save has it.
  const wanted = new Map<string, TtsModelIn>();
  const add = (th: TtsThing, kind: AssetKind, unit?: string) => {
    const m = wanted.get(th.key);
    const names = [th.nickname, unit].filter((n): n is string => !!n);
    if (m) m.names = [...new Set([...m.names, ...names])];
    else
      wanted.set(th.key, {
        key: th.key,
        name: th.nickname || unit || t("TTS model"),
        mesh: th.mesh,
        ...(th.diffuse ? { diffuse: th.diffuse } : {}),
        scale: th.scale,
        kind,
        names,
        ...(th.description ? { description: th.description.slice(0, 400) } : {}),
      });
  };
  for (const th of scan.terrain) add(th, "terrain");
  for (const u of scan.units) for (const th of u.models) add(th, "miniature", u.name);

  const got = new Map<string, TtsAsset & { asset: ModelAsset }>();
  let missing = 0;
  let failed = 0;
  const lost: string[] = [];
  for (const [i, m] of [...wanted.values()].entries()) {
    progress(t("Importing {n} of {total}: {name}", { n: i + 1, total: wanted.size, name: m.name }));
    const r = await importTtsModel(m, folder, scan.title);
    if (r === "missing" || r === "failed") {
      if (r === "missing") missing++;
      else failed++;
      if (!lost.includes(m.name)) lost.push(m.name);
    } else {
      const { min, max } = r.asset.bounds;
      got.set(m.key, {
        asset: r.asset,
        id: r.asset.id,
        name: r.asset.name,
        width: max[0] - min[0],
        depth: max[2] - min[2],
        height: max[1] - min[1],
        centre: r.centre,
      });
    }
  }

  const size = systemOf({ system }).defaultTable ?? { width: 60, depth: 44 };
  const isMat = (th: TtsThing) => {
    const a = got.get(th.key);
    return !!a && a.width >= MAT_ACROSS && a.depth >= MAT_ACROSS && (a.height < MAT_HEIGHT || !!th.board);
  };
  // A table laid out the other way round in TTS (its long side along z) turns to fit ours.
  const mat = scan.terrain.find(isMat);
  const long = (w: number, d: number) => (w === d ? 0 : w > d ? 1 : -1);
  const turned = (() => {
    if (mat) {
      const a = got.get(mat.key)!;
      const across = Math.abs(Math.sin(mat.pose.facing)) > 0.7;
      const [w, d] = across ? [a.depth, a.width] : [a.width, a.depth];
      return long(w, d) * long(size.width, size.depth) < 0;
    }
    const all = [...scan.terrain, ...scan.units.filter((u) => u.placed).flatMap((u) => u.models)];
    const reach = (k: "x" | "y") => Math.max(0, ...all.map((th) => Math.abs(th.pose[k])));
    return reach("y") > size.depth / 2 + 1 && reach("x") <= size.depth / 2;
  })();
  const fitted = turned ? turnTable(scan, Math.PI / 2) : scan;
  // Player 1 sits on the +y edge: when the two armies face each other across y the wrong way round, the table turns
  // round to bring them there, terrain and all (UX 473).
  const m0 = armyMiddle(fitted, 0);
  const m1 = armyMiddle(fitted, 1);
  const table =
    m0 && m1 && Math.abs(m0.y - m1.y) > Math.abs(m0.x - m1.x) && m0.y < m1.y
      ? turnTable(fitted, Math.PI)
      : fitted;

  const mod = systemModule(system);
  const base = mod.layout(size);
  const category = mod.templateCategory?.["Ruin"];
  let off = 0;
  const terrain = table.terrain.flatMap((th, i) => {
    const a = got.get(th.key);
    if (!a || isMat(th)) return [];
    const at = placeOnTable(th.pose, a.centre, th.scale);
    if (Math.abs(at.x) > size.width / 2 || Math.abs(at.y) > size.depth / 2) off++;
    const piece = makePiece("Ruin", `t-tts-${i}`, { x: at.x, y: at.y }, at.facing, category);
    return [{ ...piece, name: th.nickname || a.name, ...meshShape(a.asset, 1) }];
  });
  const saved: SavedTable = {
    format: TABLE_FORMAT,
    id: crypto.randomUUID(),
    name: scan.title,
    system,
    savedAt: Date.now(),
    table: { width: size.width, depth: size.depth },
    layout: { terrain, zones: base.zones, objectives: base.objectives },
  };
  const sideName = (side: 0 | 1) =>
    side === 0 ? t("{save}: near side", { save: scan.title }) : t("{save}: far side", { save: scan.title });
  const armies = ttsArmies(table, got, system, sideName).map((a) => ({
    side: a.side,
    army: {
      format: ARMY_FORMAT,
      id: crypto.randomUUID(),
      name: a.roster.name,
      system,
      savedAt: Date.now(),
      roster: a.roster,
      figures: a.figures,
    } satisfies SavedArmy,
  }));
  for (const u of table.units)
    for (const m of u.placed ? u.models : [])
      if (Math.abs(m.pose.x) > size.width / 2 || Math.abs(m.pose.y) > size.depth / 2) off++;

  await useTables.getState().load();
  useTables.getState().put(saved);
  await useShelf.getState().load();
  for (const a of armies) useShelf.getState().put(a.army);
  return { table: saved, armies, missing, failed, lost, off };
}
