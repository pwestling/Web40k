/**
 * Army list import for 40k: BattleScribe / New Recruit roster XML (`.ros`),
 * zipped rosters (`.rosz`) and New Recruit JSON exports.
 *
 * Both formats describe the same tree (roster > forces > selections, each
 * selection carrying profiles, rules, categories, costs and child
 * selections), so they are first normalised into `RNode`s and a single
 * extractor turns those into `ImportedUnit`s.
 *
 * Nothing here throws on bad input: problems are reported in `warnings`.
 */
import type { Ability, BaseShape, Characteristics, StandInLook, UnitSheet, WeaponProfile } from "../../core";

export type { Ability, Characteristics, UnitSheet, WeaponProfile };

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface ImportedModel {
  profile: { name: string; chars: Characteristics };
  /** Keys of `sheet.weapons`; a key repeats if the model carries two. */
  weapons: string[];
  /** Its own base, when it differs from the unit's (a character on a bigger base). */
  base?: BaseShape;
  /** Its stand-in figure's shape and colour (a game's own sample armies). */
  look?: StandInLook;
  /** Its height in inches, for line of sight; from the base when missing. */
  height?: number;
}

export interface ImportedUnit {
  name: string;
  sheet: UnitSheet;
  models: ImportedModel[];
  base: BaseShape;
  /** Characteristics the roster left blank, for the player to fill in before deploying. */
  missing?: string[];
  /** A suggested frontage for a ranked block (rank-and-flank sample armies). */
  files?: number;
}

export interface ImportedRoster {
  name: string;
  points?: number;
  units: ImportedUnit[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Normalised tree
// ---------------------------------------------------------------------------

export interface RProfile {
  name: string;
  typeName: string;
  chars: { name: string; value: string }[];
}

export interface RNode {
  name: string;
  type: string;
  number: number;
  profiles: RProfile[];
  rules: Ability[];
  categories: string[];
  pts: number;
  selections: RNode[];
}

export interface RForce {
  selections: RNode[];
  forces: RForce[];
}

export interface RRoster {
  name: string;
  pts?: number;
  forces: RForce[];
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Text content of a value that may be a string, number or text-node object. */
function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(text).join("");
  if (isObj(v)) {
    for (const k of ["$text", "#text", "value", "_", "text"]) {
      if (k in v) return text(v[k]);
    }
  }
  return "";
}

/** Attribute or plain property `key` (XML attributes are prefixed with "@_"). */
function attr(o: Obj, key: string): string {
  const v = o[`@_${key}`] ?? o[key] ?? (isObj(o.$) ? o.$[key] : undefined);
  return text(v);
}

/**
 * Children listed under `plural`, tolerating `[...]`, `{ singular: [...] }`,
 * `{ singular: {...} }` and a bare single object.
 */
function list(o: Obj, plural: string, singular: string): Obj[] {
  const v = o[plural];
  let items: unknown;
  if (Array.isArray(v)) items = v;
  else if (isObj(v)) items = singular in v ? v[singular] : v;
  else return [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.filter(isObj);
}

function ptsOf(o: Obj): number {
  let total = 0;
  for (const c of list(o, "costs", "cost")) {
    if (attr(c, "name").trim().toLowerCase() === "pts") {
      const n = parseFloat(attr(c, "value"));
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

function hasPts(o: Obj): boolean {
  return list(o, "costs", "cost").some((c) => attr(c, "name").trim().toLowerCase() === "pts");
}

function toProfile(o: Obj): RProfile {
  return {
    name: attr(o, "name").trim(),
    typeName: attr(o, "typeName").trim(),
    chars: list(o, "characteristics", "characteristic").map((c) => ({
      name: attr(c, "name").trim(),
      value: text(c).trim(),
    })),
  };
}

function toNode(o: Obj): RNode {
  const num = parseInt(attr(o, "number"), 10);
  return {
    name: attr(o, "name").trim(),
    type: attr(o, "type").trim().toLowerCase(),
    number: Number.isFinite(num) && num > 0 ? num : 1,
    profiles: list(o, "profiles", "profile").map(toProfile),
    rules: list(o, "rules", "rule").map((r) => ({
      name: attr(r, "name").trim(),
      text: text(r.description).trim(),
    })),
    categories: list(o, "categories", "category").map((c) => attr(c, "name").trim()),
    pts: ptsOf(o),
    selections: list(o, "selections", "selection").map(toNode),
  };
}

function toForce(o: Obj): RForce {
  return {
    selections: list(o, "selections", "selection").map(toNode),
    forces: list(o, "forces", "force").map(toForce),
  };
}

function toRoster(o: Obj): RRoster {
  return {
    name: attr(o, "name").trim(),
    pts: hasPts(o) ? ptsOf(o) : undefined,
    forces: list(o, "forces", "force").map(toForce),
  };
}

// ---------------------------------------------------------------------------
// Format front-ends
// ---------------------------------------------------------------------------

const XML_ARRAY_TAGS = new Set([
  "force",
  "selection",
  "profile",
  "characteristic",
  "rule",
  "category",
  "cost",
]);

let xmlReader: typeof import("fast-xml-parser") | null = null;

/** The XML reader loads on demand, so the front door doesn't carry it. parseRosterFile waits for it. */
export async function loadRosterParsers(): Promise<void> {
  xmlReader ??= await import("fast-xml-parser");
}

function parseXml(xml: string, warnings: string[]): RRoster | undefined {
  if (!xmlReader) {
    warnings.push("The roster reader isn't loaded yet (call loadRosterParsers first).");
    return undefined;
  }
  const { XMLParser, XMLValidator } = xmlReader;
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    warnings.push(`Could not read roster XML: ${valid.err.msg} (line ${valid.err.line})`);
    return undefined;
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name) => XML_ARRAY_TAGS.has(name),
  });
  const doc: unknown = parser.parse(xml);
  const root = isObj(doc) ? doc.roster : undefined;
  if (!isObj(root)) {
    warnings.push("File is XML but has no <roster> element.");
    return undefined;
  }
  return toRoster(root);
}

function parseJson(json: string, warnings: string[]): RRoster | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    warnings.push(`Could not read roster JSON: ${(e as Error).message}`);
    return undefined;
  }
  const root = isObj(doc) && isObj(doc.roster) ? doc.roster : doc;
  if (!isObj(root) || !("forces" in root)) {
    warnings.push("File is JSON but does not look like a roster (no forces).");
    return undefined;
  }
  return toRoster(root);
}

/** Turns the normalised roster tree into units; each system brings its own. */
export type RosterExtractor = (roster: RRoster, warnings: string[]) => ImportedUnit[];

/** Parse roster text, auto-detecting XML or JSON. */
export function parseRosterText(input: string, extract: RosterExtractor = extractUnits): ImportedRoster {
  const warnings: string[] = [];
  // trim() also strips a leading byte-order mark.
  const src = input.trim();
  let roster: RRoster | undefined;
  if (src.startsWith("<")) roster = parseXml(src, warnings);
  else if (src.startsWith("{") || src.startsWith("[")) roster = parseJson(src, warnings);
  else warnings.push("Unrecognised roster format: expected BattleScribe XML or New Recruit JSON.");
  if (!roster) return { name: "", units: [], warnings };
  const units = extract(roster, warnings);
  if (units.length === 0) warnings.push("No units found in roster.");
  return { name: roster.name, points: roster.pts, units, warnings };
}

/** Parse an uploaded roster file (`.ros`, `.rosz`, `.json`, or anything sniffable). */
export async function parseRosterFile(
  fileName: string,
  data: Uint8Array,
  extract: RosterExtractor = extractUnits,
): Promise<ImportedRoster> {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
  const isZip = data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03;
  const pre: string[] = [];
  if (!["ros", "rosz", "json", "xml", "txt"].includes(ext)) {
    pre.push(`Unknown file type "${fileName}"; guessing the format from its contents.`);
  }
  await loadRosterParsers();
  let textContent: string;
  if (isZip) {
    let files: Record<string, Uint8Array>;
    try {
      const { unzipSync } = await import("fflate");
      files = unzipSync(data);
    } catch (e) {
      return {
        name: "",
        units: [],
        warnings: [...pre, `Could not unzip ${fileName}: ${(e as Error).message}`],
      };
    }
    const names = Object.keys(files).filter((n) => !n.endsWith("/"));
    const pick =
      names.find((n) => n.toLowerCase().endsWith(".ros")) ??
      names.find((n) => /\.(xml|json)$/i.test(n)) ??
      names[0];
    const entry = pick === undefined ? undefined : files[pick];
    if (!entry) return { name: "", units: [], warnings: [...pre, `${fileName} contains no roster file.`] };
    textContent = decode(entry);
  } else {
    if (ext === "rosz") pre.push(`${fileName} is not a zip archive; reading it as plain text.`);
    textContent = decode(data);
  }
  const result = parseRosterText(textContent, extract);
  result.warnings.unshift(...pre);
  return result;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const isUnitProfile = (p: RProfile) => p.typeName.toLowerCase() === "unit";

function weaponKind(p: RProfile): "ranged" | "melee" | undefined {
  const t = p.typeName.toLowerCase();
  if (t.startsWith("ranged weapon")) return "ranged";
  if (t.startsWith("melee weapon")) return "melee";
  return undefined;
}

/** Breadth-first search for the nearest "Unit" profile in a subtree. */
function nearestUnitProfile(node: RNode): RProfile | undefined {
  const queue: RNode[] = [node];
  for (let n = queue.shift(); n; n = queue.shift()) {
    const p = n.profiles.find(isUnitProfile);
    if (p) return p;
    queue.push(...n.selections);
  }
  return undefined;
}

export function walk(node: RNode, visit: (n: RNode) => void): void {
  visit(node);
  for (const c of node.selections) walk(c, visit);
}

function collectUnits(force: RForce, out: RNode[]): void {
  for (const sel of force.selections) {
    if (sel.type === "upgrade") continue;
    if (sel.type !== "" && sel.type !== "unit" && sel.type !== "model") continue;
    if (nearestUnitProfile(sel)) out.push(sel);
  }
  for (const f of force.forces) collectUnits(f, out);
}

/** Model-group selections under `node`, not recursing into a model. */
export function modelGroups(node: RNode, out: RNode[] = []): RNode[] {
  for (const c of node.selections) {
    if (c.type === "model") out.push(c);
    else modelGroups(c, out);
  }
  return out;
}

const UNIT_CHAR_KEYS: Record<string, string> = {
  M: "M",
  MOVE: "M",
  MOVEMENT: "M",
  T: "T",
  TOUGHNESS: "T",
  SV: "SV",
  SAVE: "SV",
  W: "W",
  WOUNDS: "W",
  LD: "LD",
  LEADERSHIP: "LD",
  OC: "OC",
  OBJECTIVECONTROL: "OC",
  INV: "INV",
  INVSV: "INV",
  ISV: "INV",
  INVULNERABLE: "INV",
  INVULNERABLESAVE: "INV",
};

const WEAPON_CHAR_KEYS: Record<string, string> = {
  RANGE: "RANGE",
  RNG: "RANGE",
  A: "A",
  ATTACKS: "A",
  BS: "BS",
  WS: "WS",
  S: "S",
  STRENGTH: "S",
  AP: "AP",
  D: "D",
  DAMAGE: "D",
};

function normKey(name: string, table: Record<string, string>): string {
  const k = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return table[k] ?? k;
}

function unitChars(p: RProfile | undefined): Characteristics {
  const chars: Characteristics = {};
  if (!p) return chars;
  for (const c of p.chars) {
    const key = normKey(c.name, UNIT_CHAR_KEYS);
    if (key && c.value !== "" && c.value !== "-") chars[key] = c.value;
  }
  return chars;
}

function stripArrow(name: string): string {
  return name.replace(/^\s*(➤|>|-)\s*/, "").trim();
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "weapon"
  );
}

/** Builds `sheet.weapons`, reusing a key for identical profiles. */
class WeaponTable {
  readonly weapons: Record<string, WeaponProfile> = {};
  private readonly bySignature = new Map<string, string>();

  add(p: RProfile, kind: "ranged" | "melee"): string {
    const name = stripArrow(p.name);
    const chars: Characteristics = {};
    let keywords: string[] = [];
    for (const c of p.chars) {
      const key = normKey(c.name, WEAPON_CHAR_KEYS);
      if (key === "KEYWORDS") {
        keywords = c.value
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k !== "" && k !== "-");
      } else if (key) {
        chars[key] = c.value;
      }
    }
    const signature = JSON.stringify([name, kind, chars, keywords]);
    const existing = this.bySignature.get(signature);
    if (existing) return existing;
    const base = `${slug(name)}-${kind}`;
    let id = base;
    for (let i = 2; id in this.weapons; i++) id = `${base}-${i}`;
    this.weapons[id] = { id, name, kind, chars, keywords };
    this.bySignature.set(signature, id);
    return id;
  }
}

/** Weapon-carrying selections in a subtree, skipping the given nodes' subtrees. */
function weaponSelections(root: RNode, table: WeaponTable, skip: Set<RNode>): { ids: string[]; n: number }[] {
  const out: { ids: string[]; n: number }[] = [];
  const visit = (n: RNode) => {
    if (skip.has(n)) return;
    const ids: string[] = [];
    for (const p of n.profiles) {
      const kind = weaponKind(p);
      if (kind) ids.push(table.add(p, kind));
    }
    if (ids.length) out.push({ ids, n: n.number });
    for (const c of n.selections) visit(c);
  };
  visit(root);
  return out;
}

const INV_RE = /(\d)\s*\+/;

function extractUnit(sel: RNode, warnings: string[]): ImportedUnit {
  const table = new WeaponTable();
  const unitProfile = nearestUnitProfile(sel);
  const groups = sel.type === "model" ? [sel] : modelGroups(sel);

  const models: ImportedModel[] = [];
  const grouped = new Set<RNode>(groups);

  if (groups.length === 0) {
    // A single-model unit (e.g. a vehicle entered as type="unit").
    const model: ImportedModel = { profile: profileOf(unitProfile, sel.name), weapons: [] };
    for (const w of weaponSelections(sel, table, new Set())) {
      for (let i = 0; i < w.n; i++) model.weapons.push(...w.ids);
    }
    models.push(model);
  } else {
    for (const g of groups) {
      const prof = profileOf(nearestUnitProfile(g) ?? unitProfile, g.name);
      const groupModels: ImportedModel[] = [];
      for (let i = 0; i < g.number; i++) {
        groupModels.push({ profile: { name: prof.name, chars: { ...prof.chars } }, weapons: [] });
      }
      // `n` is the total count across the group: deal copies round robin,
      // continuing from where the previous weapon left off.
      let cursor = 0;
      for (const w of weaponSelections(g, table, new Set())) {
        for (let i = 0; i < w.n; i++) {
          groupModels[cursor % groupModels.length]?.weapons.push(...w.ids);
          cursor++;
        }
      }
      models.push(...groupModels);
    }
    // Wargear on the unit but outside any model group. A count of 1 is read
    // as "the unit's loadout" (every model gets one); a larger count is dealt
    // round robin across all models of the unit.
    if (sel.type !== "model") {
      let cursor = 0;
      for (const w of weaponSelections(sel, table, grouped)) {
        if (w.n <= 1) {
          for (const m of models) m.weapons.push(...w.ids);
        } else {
          for (let i = 0; i < w.n; i++) {
            models[cursor % models.length]?.weapons.push(...w.ids);
            cursor++;
          }
        }
      }
    }
  }

  // Abilities, rules, keywords and points across the whole subtree.
  const abilities: Ability[] = [];
  const seenAbility = new Set<string>();
  const addAbility = (a: Ability) => {
    const key = a.name.toLowerCase();
    if (!a.name || seenAbility.has(key)) return;
    seenAbility.add(key);
    abilities.push(a);
  };
  const keywords: string[] = [];
  let points = 0;
  let inv: string | undefined;
  walk(sel, (n) => {
    points += n.pts;
    for (const p of n.profiles) {
      if (isUnitProfile(p) || weaponKind(p)) continue;
      const desc = p.chars.find((c) => /^description$/i.test(c.name));
      const textValue = desc
        ? desc.value
        : p.chars
            .filter((c) => c.value !== "")
            .map((c) => `${c.name}: ${c.value}`)
            .join("; ");
      addAbility({ name: p.name, text: textValue });
    }
    for (const r of n.rules) addAbility(r);
    for (const c of n.categories) {
      const kw = c.replace(/^faction:\s*/i, "").trim();
      if (kw && !keywords.includes(kw)) keywords.push(kw);
    }
  });
  for (const a of abilities) {
    if (/invulnerable/i.test(a.name)) {
      const m = INV_RE.exec(a.text) ?? INV_RE.exec(a.name);
      if (m) {
        inv = `${m[1]}+`;
        break;
      }
    }
  }
  if (inv) {
    for (const m of models) if (!m.profile.chars.INV) m.profile.chars.INV = inv;
  }

  if (models.length === 0) warnings.push(`Unit ${sel.name} has no models.`);

  const sheet: UnitSheet = { weapons: table.weapons, abilities, keywords };
  if (points > 0) sheet.points = points;
  const unit = { name: sel.name, sheet, models };
  return { ...unit, base: suggestBase(unit) };
}

function profileOf(p: RProfile | undefined, fallbackName: string): ImportedModel["profile"] {
  return { name: p?.name || fallbackName, chars: unitChars(p) };
}

function extractUnits(roster: RRoster, warnings: string[]): ImportedUnit[] {
  const sels: RNode[] = [];
  for (const f of roster.forces) collectUnits(f, sels);
  return sels.map((s) => extractUnit(s, warnings));
}

// ---------------------------------------------------------------------------
// Base suggestion
// ---------------------------------------------------------------------------

/**
 * Pick a plausible base from keywords and the first model's wounds. Players
 * can always change it; this only needs to be a sensible default.
 */
export function suggestBase(unit: { sheet: UnitSheet; models: ImportedModel[] }): BaseShape {
  const tokens = new Set(
    unit.sheet.keywords.flatMap((k) => k.toUpperCase().split(/[^A-Z]+/)).filter((t) => t !== ""),
  );
  const has = (...k: string[]) => k.some((x) => tokens.has(x));
  const w = parseInt(unit.models[0]?.profile.chars.W ?? "", 10) || 1;

  if (has("VEHICLE") && !has("WALKER")) {
    if (w <= 10) return { shape: "rect", widthMm: 70, depthMm: 105 };
    if (w <= 14) return { shape: "rect", widthMm: 90, depthMm: 150 };
    return { shape: "rect", widthMm: 110, depthMm: 180 };
  }
  if (has("MONSTER", "WALKER")) {
    if (w >= 18) return { shape: "round", diameterMm: 130 };
    if (w <= 8) return { shape: "round", diameterMm: 60 };
    if (w <= 12) return { shape: "round", diameterMm: 90 };
    return { shape: "round", diameterMm: 100 };
  }
  if (has("MOUNTED", "CAVALRY", "BIKE", "BIKER", "BIKES")) {
    return { shape: "oval", widthMm: 75, depthMm: 42 };
  }
  if (w >= 5) return { shape: "round", diameterMm: 50 };
  if (w >= 3 || has("CHARACTER")) return { shape: "round", diameterMm: 40 };
  if (w <= 1) return { shape: "round", diameterMm: 28 };
  return { shape: "round", diameterMm: 32 };
}
