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
import type {
  Ability,
  Army,
  ArmyStratagem,
  BaseShape,
  Characteristics,
  StandInLook,
  UnitSheet,
  WeaponProfile,
} from "../../core";

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
  /** The army's own colour (a package's faction): its player takes it on deploying, unless someone has it. */
  color?: string;
  units: ImportedUnit[];
  /** The detachment, its rules and stratagems (#49); none when the roster names none. */
  army?: Army;
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
  /** The option group it was picked from, when the export names it ("Enhancements"). */
  group: string;
  pts: number;
  selections: RNode[];
}

export interface RForce {
  /** The faction's catalogue. */
  catalogueName: string;
  rules: Ability[];
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

function toRules(o: Obj): Ability[] {
  return list(o, "rules", "rule").map((r) => ({
    name: attr(r, "name").trim(),
    text: text(r.description).trim(),
  }));
}

function toNode(o: Obj): RNode {
  const num = parseInt(attr(o, "number"), 10);
  return {
    name: attr(o, "name").trim(),
    type: attr(o, "type").trim().toLowerCase(),
    number: Number.isFinite(num) && num > 0 ? num : 1,
    profiles: list(o, "profiles", "profile").map(toProfile),
    rules: toRules(o),
    categories: list(o, "categories", "category").map((c) => attr(c, "name").trim()),
    group: (attr(o, "group") || attr(o, "entryGroupName")).trim(),
    pts: ptsOf(o),
    selections: list(o, "selections", "selection").map(toNode),
  };
}

function toForce(o: Obj): RForce {
  return {
    catalogueName: attr(o, "catalogueName").trim(),
    rules: toRules(o),
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
type RosterExtractor = (roster: RRoster, warnings: string[]) => ImportedUnit[];

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
  const army = extract === extractUnits ? extractArmy(roster) : undefined;
  // Units list the detachment's rule too (BSData links it to each): it runs once, army-wide.
  const detachmentRules = new Set(army?.rules.map((a) => a.name.toLowerCase()));
  for (const u of units)
    u.sheet.abilities = u.sheet.abilities.map((a) =>
      detachmentRules.has(a.name.toLowerCase()) && !a.group
        ? { ...a, group: army!.rules.find((r) => r.name.toLowerCase() === a.name.toLowerCase())!.group }
        : a,
    );
  return { name: roster.name, points: roster.pts, units, ...(army ? { army } : {}), warnings };
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
  const enhancements = enhancementNodes(sel);
  walk(sel, (n) => {
    points += n.pts;
    const enhancement = enhancements.has(n);
    const before = abilities.length;
    for (const p of n.profiles) {
      if (isUnitProfile(p) || weaponKind(p) || isStratagemProfile(p)) continue;
      const desc = p.chars.find((c) => /^description$/i.test(c.name));
      const textValue = desc
        ? desc.value
        : p.chars
            .filter((c) => c.value !== "")
            .map((c) => `${c.name}: ${c.value}`)
            .join("; ");
      addAbility({ name: p.name, text: textValue, ...(enhancement ? { group: ENHANCEMENTS } : {}) });
    }
    for (const r of n.rules)
      if (!isStratagemRule(r)) addAbility(enhancement ? { ...r, group: ENHANCEMENTS } : r);
    // An enhancement listed by name only still shows (and counts) as one.
    if (enhancement && abilities.length === before)
      addAbility({ name: n.name, text: "", group: ENHANCEMENTS });
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

// ---------------------------------------------------------------------------
// The army: detachment, its rules, enhancements and stratagems (#49)
// ---------------------------------------------------------------------------

/** The heading enhancements are listed under on a unit card. */
export const ENHANCEMENTS = "Enhancements";
/** The heading a detachment's rules are listed under, on the army and on unit cards. */
export const DETACHMENT_RULE = "Detachment rule";
/** The heading the army rule (the faction's, on the force) is listed under. */
export const ARMY_RULE = "Army rule";
const ENHANCEMENT_RE = /enhancement/i;
const STRATAGEM_RE = /stratagem/i;
const PHASE_RE = /\b(command|movement|shooting|charge|fight)\s+phase/gi;

const isStratagemProfile = (p: RProfile) => STRATAGEM_RE.test(p.typeName);
/** A rule written out as a stratagem: "WHEN: … EFFECT: …". */
const isStratagemRule = (r: Ability) => /\bwhen\s*:/i.test(r.text) && /\beffect\s*:/i.test(r.text);

function isEnhancementNode(n: RNode): boolean {
  return (
    ENHANCEMENT_RE.test(n.group) ||
    n.categories.some((c) => ENHANCEMENT_RE.test(c)) ||
    n.profiles.some((p) => ENHANCEMENT_RE.test(p.typeName)) ||
    // BattleScribe saves only the group's id: an upgrade bought with points that is all abilities (wargear is free).
    (n.type === "upgrade" &&
      n.pts > 0 &&
      n.profiles.length > 0 &&
      n.profiles.every((p) => /abilit/i.test(p.typeName)) &&
      n.selections.length === 0)
  );
}

/** Enhancements in a unit: marked as such, or picked under a selection named for them. */
function enhancementNodes(root: RNode): Set<RNode> {
  const out = new Set<RNode>();
  const visit = (n: RNode, under: boolean) => {
    if (under || isEnhancementNode(n)) out.add(n);
    for (const c of n.selections) visit(c, under || ENHANCEMENT_RE.test(n.name));
  };
  for (const c of root.selections) visit(c, ENHANCEMENT_RE.test(root.name));
  return out;
}

function stratagemId(name: string, taken: Set<string>): string {
  const base = slug(name);
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

/** "Name (1CP)" or "Name - 1 CP": the name without its cost, and the cost. */
function nameAndCost(name: string): { name: string; cp?: number } {
  const m = /\s*(?:[-–(]\s*)?(\d+)\s*cp\s*\)?\s*$/i.exec(name);
  return m ? { name: name.slice(0, m.index).trim(), cp: Number(m[1]) } : { name: name.trim() };
}

/** Whose turn it is used in, read from its When text. */
export function stratagemSide(when: string): ArmyStratagem["side"] {
  const theirs = /opponent'?s/i.test(when);
  const mine = /\byour\s+(?!opponent)/i.test(when);
  // "the Fight phase", "any phase": either player's.
  if (/\b(?:the|any|each|either player's)\s+(?:[a-z]+\s+)?phase/i.test(when)) return "either";
  if (theirs && !mine) return "inactive";
  if (mine && !theirs) return "active";
  return "either";
}

/** The phases named in its When text (system phase ids); none for any phase. */
export function stratagemPhases(when: string): string[] {
  const out: string[] = [];
  for (const m of when.matchAll(PHASE_RE)) {
    const id = m[1]!.toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** "WHEN: … TARGET: … EFFECT: … RESTRICTIONS: …" split into its parts. */
function stratagemParts(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\b(when|target|effect|restrictions?)\s*:\s*/gi;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.index ?? text.length;
    out[m[1]!.toLowerCase().replace(/s$/, "")] = text.slice(m.index! + m[0].length, end).trim();
  });
  return out;
}

function makeStratagem(
  rawName: string,
  fields: { cp?: string; when?: string; target?: string; effect?: string },
  text: string,
  taken: Set<string>,
): ArmyStratagem {
  const named = nameAndCost(rawName);
  const cpText = /(\d+)/.exec(fields.cp ?? "")?.[1] ?? /\b(\d+)\s*cp\b/i.exec(text)?.[1];
  const cp = named.cp ?? (cpText !== undefined ? Number(cpText) : 1);
  const when = fields.when ?? "";
  const phases = stratagemPhases(when);
  const target = fields.target ?? "";
  const kws = /^\s*(?:one|a|an)\s+(.+?)\s+units?\b.*\bfrom your army/i
    .exec(target)?.[1]
    ?.replace(/\bfriendly\b/i, "")
    .trim();
  const notYet = /\bnot (?:yet )?(shot|fought|charged|made a charge move)\b/i
    .exec(target)?.[1]
    ?.toLowerCase();
  return {
    id: stratagemId(named.name, taken),
    name: named.name,
    cp,
    side: stratagemSide(when),
    ...(phases.length ? { phases } : {}),
    ...(/\bunits?\b/i.test(target) && /your army|friendly/i.test(target) ? { targetsUnit: true } : {}),
    ...(kws ? { targetKeywords: kws } : {}),
    ...(notYet
      ? { notYet: notYet.startsWith("made") ? "charged" : (notYet as "shot" | "fought" | "charged") }
      : {}),
    ...(when ? { when } : {}),
    ...(target ? { target } : {}),
    ...(fields.effect ? { effect: fields.effect } : {}),
    text,
  };
}

function profileStratagem(p: RProfile, taken: Set<string>): ArmyStratagem {
  const fields: Record<string, string> = {};
  for (const c of p.chars) {
    const k = c.name.toLowerCase().replace(/[^a-z]/g, "");
    if (k === "cp" || k === "cost" || k === "commandpoints") fields.cp = c.value;
    else if (k === "when") fields.when = c.value;
    else if (k === "target" || k === "targets") fields.target = c.value;
    else if (k === "effect" || k === "effects") fields.effect = c.value;
    else if (k === "description" && !fields.effect) Object.assign(fields, stratagemParts(c.value));
  }
  const text = p.chars
    .filter((c) => c.value !== "" && !/^(cp|cost)$/i.test(c.name))
    .map((c) => `${c.name}: ${c.value}`)
    .join("\n");
  return makeStratagem(p.name, fields, text, taken);
}

function ruleStratagem(r: Ability, taken: Set<string>): ArmyStratagem {
  return makeStratagem(r.name, stratagemParts(r.text), r.text, taken);
}

/**
 * A stratagem the player pastes from their own book (rosters rarely carry
 * them): its name on the first line, then its When, Target and Effect.
 */
export function parseStratagemText(input: string, taken: string[] = []): ArmyStratagem | null {
  const text = input.trim();
  const parts = stratagemParts(text);
  if (!parts.effect) return null;
  const first = text.split(/\n/)[0]!.trim();
  const name = /^(when|target|effect)\s*:/i.test(first)
    ? "Stratagem"
    : first.replace(/^stratagem\s*[:\-–]\s*/i, "");
  const body = text.slice(/^(when|target|effect)\s*:/i.test(first) ? 0 : first.length).trim();
  return makeStratagem(name, parts, body, new Set(taken));
}

const isDetachmentNode = (n: RNode) =>
  /\bdetachment\b/i.test(n.name) && n.type !== "unit" && n.type !== "model";

/**
 * The army-wide part of a roster: its faction, its detachment and the
 * detachment's rules, and any stratagems the export carries (as profiles or
 * as rules written "WHEN: … EFFECT: …"). Undefined when there are none.
 */
function extractArmy(roster: RRoster): Army | undefined {
  const forces: RForce[] = [];
  const allForces = (f: RForce) => {
    forces.push(f);
    f.forces.forEach(allForces);
  };
  roster.forces.forEach(allForces);
  const faction = forces.map((f) => f.catalogueName).find(Boolean);
  let detachment: string | undefined;
  const rules: Ability[] = [];
  const stratagems: ArmyStratagem[] = [];
  const taken = new Set<string>();
  const seenRule = new Set<string>();
  const seenStrat = new Set<string>();
  const addStrat = (s: ArmyStratagem) => {
    if (seenStrat.has(s.name.toLowerCase())) return taken.delete(s.id);
    seenStrat.add(s.name.toLowerCase());
    stratagems.push(s);
  };
  const addRule = (a: Ability) => {
    if (!a.name || seenRule.has(a.name.toLowerCase())) return;
    seenRule.add(a.name.toLowerCase());
    rules.push({ ...a, group: DETACHMENT_RULE });
  };
  const scan = (n: RNode, inDetachment: boolean) => {
    const here = inDetachment || isDetachmentNode(n);
    for (const p of n.profiles) {
      if (isStratagemProfile(p)) addStrat(profileStratagem(p, taken));
      else if (here && !isUnitProfile(p) && !weaponKind(p)) {
        const desc = p.chars.find((c) => /^description$/i.test(c.name));
        addRule({ name: p.name, text: desc ? desc.value : p.chars.map((c) => c.value).join(" ") });
      }
    }
    for (const r of n.rules) {
      if (isStratagemRule(r)) addStrat(ruleStratagem(r, taken));
      else if (here) addRule(r);
    }
    for (const c of n.selections) scan(c, here);
  };
  for (const f of forces) {
    // The army rule (on the force): listed with the detachment's (UX 372).
    for (const r of f.rules)
      if (isStratagemRule(r)) addStrat(ruleStratagem(r, taken));
      else if (r.name && !seenRule.has(r.name.toLowerCase())) {
        seenRule.add(r.name.toLowerCase());
        rules.push({ ...r, group: ARMY_RULE });
      }
    for (const sel of f.selections) {
      if (isDetachmentNode(sel) && !detachment) {
        // "Detachment" with the choice as its child, or the choice named in it ("Detachment: X").
        const child = sel.selections[0]?.name;
        const own = sel.name.replace(/^\s*detachment( choice)?\s*[:\-–]?\s*/i, "").trim();
        detachment = child || own || rulesName(sel);
      }
      scan(sel, false);
    }
  }
  if (!detachment && !stratagems.length && !rules.length) return undefined;
  return {
    ...(roster.name ? { name: roster.name } : {}),
    ...(faction ? { faction } : {}),
    ...(detachment ? { detachment } : {}),
    rules,
    stratagems,
  };
}

function rulesName(n: RNode): string | undefined {
  return n.rules[0]?.name || n.profiles[0]?.name || undefined;
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
