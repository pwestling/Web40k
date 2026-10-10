import type { AssetKind } from "../assets/types";
import { t } from "../i18n";

/**
 * Tabletop Simulator saves and mods as a source of figures. A TTS save is
 * JSON: every object on the table, in bags and in alternate states, with
 * custom models naming their mesh (.obj) and diffuse image by URL. TTS keeps
 * a copy of each download in its Mods folder, named after the URL with
 * everything but letters and digits taken out, so a player's own TTS folder
 * holds the files for every mod they've played. Nothing here fetches; the
 * importer (TtsImport.tsx) reads the folder or downloads what it can.
 */

/** One distinct custom model in a save: the same mesh, image and size counts once. */
export interface TtsModel {
  key: string;
  /** The name it goes by most, for the library. */
  name: string;
  /** Every name the save gives it: its nicknames, then the bags it sits in. Matched against army units. */
  names: string[];
  /** Its TTS description, without markup. */
  description?: string;
  mesh: string;
  diffuse?: string;
  /** Inches per mesh unit: TTS tables measure one unit to the inch, so this is the object's scale. */
  scale: number;
  /** How many times the save uses it. */
  count: number;
  /** A guess the player can change: locked objects, boards and terrain words are terrain. */
  kind: AssetKind;
}

export interface TtsScan {
  title: string;
  models: TtsModel[];
  /** Unity asset bundles, which only Unity can read. */
  bundles: number;
}

export interface TtsObject {
  Name?: string;
  Nickname?: string;
  Description?: string;
  Locked?: boolean;
  Tags?: string[];
  /** Its script: Yellowscribe writes the unit's datasheet into a leader model's (#75). */
  LuaScript?: string;
  Transform?: {
    posX?: number;
    posY?: number;
    posZ?: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
  };
  CustomMesh?: { MeshURL?: string; DiffuseURL?: string; TypeIndex?: number };
  ContainedObjects?: TtsObject[];
  ChildObjects?: TtsObject[];
  /** Cards (#75): the sheets a deck's or card's faces are cut from, by sheet number. */
  CustomDeck?: Record<
    string,
    { FaceURL?: string; BackURL?: string; NumWidth?: number; NumHeight?: number; UniqueBack?: boolean }
  >;
  /** A card's sheet number × 100 + its cell. */
  CardID?: number;
  /** A deck's cards, top first, when its ContainedObjects aren't written out. */
  DeckIDs?: number[];
  SidewaysCard?: boolean;
  States?: Record<string, TtsObject>;
}

const TERRAIN_WORDS =
  /\b(terrain|ruins?|buildings?|walls?|crates?|barricades?|forests?|trees?|containers?|hills?|craters?|rocks?|bunkers?|scatter|board|table|mat|floor)\b/i;
/** CustomMesh.TypeIndex for a board. */
const BOARD = 4;

/** A custom model's files and size, and the key the same model goes by everywhere in a save. */
export function customOf(
  o: TtsObject,
): { key: string; mesh: string; diffuse?: string; scale: number } | null {
  const mesh = o.CustomMesh?.MeshURL?.trim();
  if (!mesh) return null;
  const diffuse = o.CustomMesh?.DiffuseURL?.trim() || undefined;
  const t = o.Transform ?? {};
  const scale = round((Math.abs(t.scaleX ?? 1) + Math.abs(t.scaleY ?? 1) + Math.abs(t.scaleZ ?? 1)) / 3) || 1;
  return { key: `${mesh}|${diffuse ?? ""}|${scale}`, mesh, ...(diffuse ? { diffuse } : {}), scale };
}

/** A guess the player can change: locked objects, boards and terrain words are terrain. */
export function looksLikeTerrain(o: TtsObject): boolean {
  return (
    o.CustomMesh?.TypeIndex === BOARD ||
    !!o.Locked ||
    TERRAIN_WORDS.test(cleanText(o.Nickname)) ||
    (o.Tags ?? []).some((tag) => TERRAIN_WORDS.test(tag))
  );
}

/** A save's objects, or an error saying it isn't one. */
export function saveObjects(json: unknown): { title: string; objects: TtsObject[] } {
  const save = (json ?? {}) as { SaveName?: string; GameMode?: string; ObjectStates?: TtsObject[] };
  if (!Array.isArray(save.ObjectStates))
    throw new Error("This isn't a Tabletop Simulator save: it has no objects.");
  return {
    title: cleanText(save.SaveName) || cleanText(save.GameMode) || "Tabletop Simulator save",
    objects: save.ObjectStates,
  };
}

export function scanSave(json: unknown): TtsScan {
  const save = saveObjects(json);
  const found = new Map<string, TtsModel & { tally: Map<string, number> }>();
  let bundles = 0;
  const visit = (o: TtsObject, bag?: string) => {
    if (!o || typeof o !== "object") return;
    if (o.Name === "Custom_AssetBundle") bundles++;
    const nickname = cleanText(o.Nickname);
    const custom = customOf(o);
    if (custom) {
      const { key, mesh, diffuse, scale } = custom;
      let m = found.get(key);
      if (m) m.count++;
      else {
        m = {
          key,
          name: "",
          names: [],
          mesh,
          diffuse,
          scale,
          count: 1,
          kind: looksLikeTerrain(o) ? "terrain" : "miniature",
          tally: new Map(),
        };
        found.set(key, m);
      }
      for (const n of [nickname, bag])
        if (n) m.tally.set(n, (m.tally.get(n) ?? 0) + (n === nickname ? 2 : 1));
      const description = cleanText(o.Description).slice(0, MAX_DESCRIPTION);
      if (description && !m.description) m.description = description;
    }
    // A bag's name is usually the unit its models make up ("Warden Squad").
    const holder = nickname && !GENERIC_BAG.test(nickname) ? nickname : bag;
    for (const c of o.ContainedObjects ?? []) visit(c, holder);
    for (const c of o.ChildObjects ?? []) visit(c, bag);
    for (const s of Object.values(o.States ?? {})) visit(s, bag);
  };
  for (const o of save.objects) visit(o);
  const models = [...found.values()].map(({ tally, ...m }) => {
    const names = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    return {
      ...m,
      names,
      name: names[0] ?? fileStem(m.mesh) ?? (m.kind === "terrain" ? t("Unnamed terrain") : t("TTS model")),
    };
  });
  return {
    title: save.title,
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
    bundles,
  };
}

const MAX_DESCRIPTION = 400;
export const GENERIC_BAG = /^(bag|infinite bag|deck|box|container)$/i;

/**
 * TTS text without its markup: BBCode and colours ("[b]", "[ff0000]", "[-]")
 * and wound counters some mods keep in names ("10/10").
 */
export function cleanText(text: string | undefined): string {
  return (text ?? "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:|,]+|[\s\-:|,]+$/g, "");
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** The last path part of a URL without its extension, if it reads like a name. */
function fileStem(url: string): string | undefined {
  const last = url.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "";
  const stem = decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, ""));
  // Steam Cloud names are hex hashes, not names, whole or cut short (PX TTS 3).
  return /^[0-9A-F]{6,}$/i.test(stem) || !/[a-z]/i.test(stem) ? undefined : stem.replace(/[_-]+/g, " ");
}

/** The name TTS gives a URL's copy in its Mods folder, less the extension. */
export const cacheName = (url: string) => url.replace(/[^A-Za-z0-9]/g, "");

/**
 * Steam moved its cloud files from cloud-3.steamusercontent.com to
 * steamusercontent-a.akamaihd.net, so one file can sit in the cache under
 * either host. The part from "ugc" on is the same for both.
 */
function ugcTail(name: string): string | undefined {
  const i = name.toLowerCase().indexOf("ugc");
  return i < 0 ? undefined : name.slice(i).toLowerCase();
}

/** A TTS folder's cached files, by the names TTS gives them. */
export interface TtsFolder {
  find(url: string, kind: "model" | "image"): File | undefined;
  saves: { label: string; file: File }[];
  /** Cached model and image files seen. */
  files: number;
}

const MODEL = /\.obj$/i;
const IMAGE = /\.(png|jpe?g|webp|bmp|gif)$/i;

/**
 * Index the files of a picked folder: the whole "Tabletop Simulator" folder
 * (Saves and Mods), or just Mods. `infos` are the JSON of TTS's own
 * SaveFileInfos.json and WorkshopFileInfos.json, which name the saves.
 */
export function indexFolder(files: File[], infos: unknown[] = []): TtsFolder {
  const models = new Map<string, File>();
  const images = new Map<string, File>();
  const modelTails = new Map<string, File>();
  const imageTails = new Map<string, File>();
  const saves: { label: string; file: File }[] = [];
  const names = new Map<string, string>();
  for (const info of infos)
    if (Array.isArray(info))
      for (const i of info as { Directory?: string; Name?: string }[])
        if (i.Directory && i.Name) names.set(baseName(i.Directory).toLowerCase(), i.Name);
  for (const file of files) {
    const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    const stem = file.name.replace(/\.[^.]+$/, "");
    if (MODEL.test(file.name)) {
      models.set(stem.toLowerCase(), file);
      const tail = ugcTail(stem);
      if (tail) modelTails.set(tail, file);
    } else if (IMAGE.test(file.name)) {
      images.set(stem.toLowerCase(), file);
      const tail = ugcTail(stem);
      if (tail) imageTails.set(tail, file);
    } else if (
      /\.json$/i.test(file.name) &&
      /(^|\/)(Saves|Workshop)\//i.test(path) &&
      !/FileInfos\.json$/i.test(file.name)
    )
      saves.push({ label: names.get(file.name.toLowerCase()) ?? stem, file });
  }
  saves.sort((a, b) => a.label.localeCompare(b.label));
  return {
    saves,
    files: models.size + images.size,
    find(url, kind) {
      const name = cacheName(url);
      const [exact, tails] = kind === "model" ? [models, modelTails] : [images, imageTails];
      const hit = exact.get(name.toLowerCase());
      if (hit) return hit;
      const tail = ugcTail(name);
      return tail ? tails.get(tail) : undefined;
    },
  };
}

const baseName = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;

/**
 * Where a browser can try to download a URL itself: https, and Steam Cloud
 * files from the host they live on now. Steam may still refuse a web page,
 * which is what the TTS folder is for.
 */
export function downloadUrl(url: string): string {
  const steam = url.match(/^https?:\/\/cloud-3\.steamusercontent\.com\/(ugc\/.*)$/i);
  if (steam) return `https://steamusercontent-a.akamaihd.net/${steam[1]}`;
  return url.replace(/^http:\/\//i, "https://");
}
