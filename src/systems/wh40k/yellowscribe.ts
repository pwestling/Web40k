import type { BaseShape } from "../../core";
import type {
  Ability,
  Characteristics,
  ImportedModel,
  ImportedRoster,
  ImportedUnit,
  UnitSheet,
  WeaponProfile,
} from "./roster";

/**
 * Yellowscribe's army data (#75): the JSON Yellowscribe (formerly BS2TTS)
 * makes from a roster and New Recruit exports, `{ edition, order, units }`,
 * the open exchange format TTS army tools read. Read into the same roster
 * shape the .ros import makes, and written back out from one. 10th and 11th
 * edition data in full; 9th edition's older shape as far as it maps (weapon
 * type as a keyword, its number as Attacks, the first wound bracket).
 *
 * Also takes the file yellowscribe.link keeps for a code, where the units sit
 * under `armyData`. Unit and ability names, text and stats are the player's
 * own list; none ship here.
 */

/** A characteristic profile: name plus lower-case characteristics (m t sv w ld oc insv; 9e also ws bs s a). */
export interface YsProfile {
  name: string;
  [char: string]: string | undefined;
}

interface YsWeapon {
  name: string;
  range: string;
  /** 10e/11e. */
  a?: string;
  bsws?: string;
  /** 9e: "Rapid Fire 1", "Melee". */
  type?: string;
  s: string;
  ap: string;
  d: string;
  number?: number;
  /** Keywords, then "Name: text" lines for the ones with their own text. */
  abilities?: string;
  /** Keywords only. */
  shortAbilities?: string;
}

interface YsAbility {
  name: string;
  desc: string;
  /** Open Battle's own: the heading it was listed under (Enhancements, Detachment rule). Yellowscribe ignores it. */
  group?: string;
}

interface YsModel {
  name: string;
  abilities?: string[];
  weapons: { name: string; number?: number }[];
  /** Weapons the site's editor assigned and hasn't merged yet. */
  assignedWeapons?: { name: string; number?: number }[];
  number?: number;
  /** Crusade F2P's precise profile key. */
  profileID?: string;
}

export interface YsUnit {
  name: string;
  decorativeName?: string;
  factionKeywords?: string[];
  keywords?: string[];
  abilities?: Record<string, YsAbility> | YsAbility[];
  models?: { models: Record<string, YsModel>; totalNumberOfModels?: number };
  modelProfiles?: Record<string, YsProfile> | YsProfile[];
  weapons?: Record<string, YsWeapon> | YsWeapon[];
  /** 9e: names of rules the roster gave no text for. */
  rules?: string[];
  /** 9e: profile name → bracket ("7+") → the values of its "*" characteristics, in profile order. */
  woundTrack?: Record<string, Record<string, string[]>>;
  isSingleModel?: boolean;
  uuid?: string;
  /** Open Battle's own: the unit's points (Yellowscribe carries none). */
  points?: number;
}

interface YsArmy {
  edition?: string;
  order: string[];
  units: Record<string, YsUnit>;
  /** Open Battle's own: the roster's name. */
  name?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const valuesOf = <T>(v: Record<string, T> | T[] | undefined): T[] =>
  Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [];

/** Yellowscribe's server makes these characters safe for TTS; they read back as themselves. */
const unsafe = (s: string) => s.replace(/＞/g, ">").replace(/＜/g, "<").replace(/\\"/g, '"');

function unitsOf(doc: unknown): Record<string, unknown> | null {
  if (!isObj(doc)) return null;
  const units = isObj(doc.units) ? doc.units : isObj(doc.armyData) ? doc.armyData : null;
  if (!units) return null;
  const all = Object.values(units);
  const looks = (u: unknown) =>
    isObj(u) && typeof u.name === "string" && (isObj(u.modelProfiles) || isObj(u.models) || isObj(u.weapons));
  return all.length > 0 && all.every(looks) ? units : null;
}

/** Whether parsed JSON is Yellowscribe army data, by its shape. */
export function isYellowscribe(doc: unknown): boolean {
  return unitsOf(doc) !== null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const CHAR_KEYS: Record<string, string> = { insv: "INV", inv: "INV" };
const charKey = (k: string) => CHAR_KEYS[k.toLowerCase()] ?? k.toUpperCase();
const CORE = ["M", "T", "SV", "W", "LD", "OC"];

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "weapon"
  );
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "" && k !== "-");

function weaponOf(w: YsWeapon): Omit<WeaponProfile, "id"> {
  const range = str(w.range).trim();
  const ninth = w.bsws === undefined && w.type !== undefined;
  const melee = /^melee$/i.test(range) || (ninth && /^melee$/i.test(str(w.type).trim()));
  const chars: Characteristics = { RANGE: melee ? "Melee" : range };
  const keywords: string[] = [];
  if (ninth) {
    // "Rapid Fire 1": the type is a keyword, its number the shots.
    const type = str(w.type).trim();
    const m = /^(.*?)\s+(\d*D\d+(?:\+\d+)?|\d+)$/i.exec(type);
    if (!melee && m) {
      chars.A = m[2]!;
      keywords.push(m[1]!);
    } else if (!melee && type) keywords.push(type);
  } else {
    if (w.a !== undefined) chars.A = str(w.a);
    if (w.bsws !== undefined) chars[melee ? "WS" : "BS"] = str(w.bsws);
  }
  chars.S = str(w.s);
  chars.AP = str(w.ap);
  chars.D = str(w.d);
  for (const k of Object.keys(chars)) if (chars[k] === "") delete chars[k];
  if (!ninth) {
    const short = w.shortAbilities ?? (w as { shortabilities?: string }).shortabilities;
    const lines = str(w.abilities).split("\n");
    for (const k of splitList(short ?? lines[0] ?? "")) if (!keywords.includes(k)) keywords.push(k);
    // A keyword with its own text comes on a line of its own: "Name: text".
    for (const l of lines.slice(short === undefined ? 1 : 0)) {
      const name = /^([^:\n]{1,60}):\s/.exec(l)?.[1]?.trim();
      if (name && !keywords.includes(name)) keywords.push(name);
    }
  }
  return { name: unsafe(str(w.name)).trim(), kind: melee ? "melee" : "ranged", chars, keywords };
}

interface YsParts {
  name: string;
  sheet: UnitSheet;
  /** The profile a model of this name wears, as Yellowscribe's TTS script picks it. */
  profile(name: string, profileID?: string): ImportedModel["profile"] | undefined;
  /** The `sheet.weapons` key of a weapon, by its name. */
  weapon(name: string): string | undefined;
}

/** A unit's datasheet from its Yellowscribe data; its models are the caller's (the JSON's, or TTS's figures). */
export function ysParts(u: YsUnit): YsParts {
  // Profiles, keyed as Yellowscribe keys them (by name, or Crusade's id).
  const track = isObj(u.woundTrack) ? u.woundTrack : undefined;
  const profiles = new Map<string, ImportedModel["profile"]>();
  const rawProfiles = Array.isArray(u.modelProfiles)
    ? u.modelProfiles.map((p) => [p.name, p] as const)
    : Object.entries(isObj(u.modelProfiles) ? u.modelProfiles : {});
  for (const [key, p] of rawProfiles) {
    if (!isObj(p)) continue;
    const name = unsafe(str(p.name) || key).trim();
    const bracket = track
      ? Object.values(track[name] ?? (Object.keys(track).length === 1 ? Object.values(track)[0]! : {}))[0]
      : undefined;
    let star = 0;
    const chars: Characteristics = {};
    for (const [k, raw] of Object.entries(p)) {
      if (k === "name" || k === "profileID") continue;
      let v = str(raw).trim();
      if (v === "*" && bracket) v = str(bracket[star++]).trim();
      if (v === "" || v === "-" || v === "*") continue;
      chars[charKey(k)] = v.replace(/\\"/g, '"');
    }
    profiles.set(key, { name, chars });
  }
  const list = [...profiles.values()];

  // Weapons by name; one key per distinct name.
  const weapons: Record<string, WeaponProfile> = {};
  const byName = new Map<string, string>();
  for (const w of valuesOf(u.weapons)) {
    if (!isObj(w) || !str(w.name)) continue;
    const read = weaponOf(w);
    const base = `${slug(read.name)}-${read.kind}`;
    let id = base;
    for (let i = 2; id in weapons; i++) id = `${base}-${i}`;
    weapons[id] = { id, ...read };
    if (!byName.has(read.name.toLowerCase())) byName.set(read.name.toLowerCase(), id);
  }

  // Abilities; Yellowscribe gathers core and faction ones into one line of names each.
  const abilities: Ability[] = [];
  const add = (a: Ability) => {
    if (a.name && !abilities.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) abilities.push(a);
  };
  for (const a of valuesOf(u.abilities)) {
    if (!isObj(a)) continue;
    const name = unsafe(str(a.name)).trim();
    const text = unsafe(str(a.desc)).trim();
    const group = typeof a.group === "string" && a.group ? { group: a.group } : {};
    if (/^(core|faction)$/i.test(name) && !/[.!?]$/.test(text))
      splitList(text).forEach((n) => add({ name: n, text: "", ...group }));
    else add({ name, text, ...group });
  }
  for (const r of u.rules ?? []) add({ name: unsafe(str(r)).trim(), text: "" });
  // 9e wound brackets: the top one is on the profile; the rest stay a reminder.
  for (const [name, brackets] of Object.entries(track ?? {})) {
    const p = list.find((x) => x.name === name) ?? (list.length === 1 ? list[0] : undefined);
    const raw = rawProfiles.find(([, x]) => x.name === p?.name)?.[1];
    const stars = raw
      ? Object.keys(raw)
          .filter((k) => raw[k] === "*")
          .map(charKey)
      : [];
    const lines = Object.entries(brackets).map(
      ([when, vals]) =>
        `${when}: ${vals.map((v, i) => (stars[i] ? `${stars[i]} ${v}` : v).replace(/\\"/g, '"')).join(", ")}`,
    );
    add({ name: `Wound track (${name})`, text: lines.join("; ") });
  }
  // An invulnerable save given as an ability (9e) goes on the profiles, as the .ros import does.
  const invAbility = abilities.find((a) => /invulnerable/i.test(a.name) || /invulnerable save/i.test(a.text));
  const inv = invAbility && /(\d)\s*\+/.exec(invAbility.text)?.[1];
  if (inv) for (const p of list) p.chars.INV ??= `${inv}+`;

  const keywords: string[] = [];
  for (const k of [...(u.factionKeywords ?? []), ...(u.keywords ?? [])]) {
    const kw = unsafe(str(k)).trim();
    if (kw && !keywords.includes(kw)) keywords.push(kw);
  }
  const sheet: UnitSheet = { weapons, abilities, keywords };
  if (typeof u.points === "number" && u.points > 0) sheet.points = u.points;

  const copy = (p: ImportedModel["profile"]) => ({ name: p.name, chars: { ...p.chars } });
  return {
    name: unsafe(str(u.name)).trim(),
    sheet,
    profile(name, profileID) {
      if (profileID !== undefined && profiles.has(profileID)) return copy(profiles.get(profileID)!);
      const n = name.trim();
      const hit =
        list.find((p) => p.name === n) ??
        list.find((p) => n && (p.name.includes(n) || n.includes(p.name))) ??
        list.find((p) => p.name.toLowerCase() === "other models") ??
        list[0];
      return hit && copy(hit);
    },
    weapon: (name) => byName.get(name.trim().toLowerCase()),
  };
}

/** The characteristics no model of the unit has (a card needs them before deploying). */
export function missingChars(models: ImportedModel[]): string[] {
  const first = models[0]?.profile.chars ?? {};
  return CORE.filter((k) => !first[k]);
}

function readUnit(
  u: YsUnit,
  suggestBase: (u: Pick<ImportedUnit, "sheet" | "models">) => BaseShape,
): ImportedUnit {
  const parts = ysParts(u);
  const models: ImportedModel[] = [];
  const entries = valuesOf(u.models?.models);
  for (const m of entries) {
    if (!isObj(m)) continue;
    const profile = parts.profile(unsafe(str(m.name)), m.profileID) ?? {
      name: unsafe(str(m.name)),
      chars: {},
    };
    const weapons: string[] = [];
    for (const w of [...(m.weapons ?? []), ...(m.assignedWeapons ?? [])]) {
      const id = parts.weapon(unsafe(str(w.name)));
      if (id) for (let i = 0; i < (Number(w.number) || 1); i++) weapons.push(id);
    }
    const n = Math.max(1, Math.round(Number(m.number) || 1));
    for (let i = 0; i < n; i++)
      models.push({ profile: { ...profile, chars: { ...profile.chars } }, weapons: [...weapons] });
  }
  // No models listed: one per profile, carrying every weapon.
  if (!models.length) {
    const all = Object.keys(parts.sheet.weapons);
    const names = valuesOf(u.modelProfiles).map((p) => str(p.name));
    for (const name of names.length ? names : [parts.name])
      models.push({ profile: parts.profile(name) ?? { name, chars: {} }, weapons: [...all] });
  }
  const missing = missingChars(models);
  const unit = { name: parts.name, sheet: parts.sheet, models };
  return { ...unit, base: suggestBase(unit), ...(missing.length ? { missing } : {}) };
}

/** Yellowscribe army data as an imported roster; null when it isn't that shape. */
export function readYellowscribe(
  doc: unknown,
  suggestBase: (u: Pick<ImportedUnit, "sheet" | "models">) => BaseShape,
): ImportedRoster | null {
  const units = unitsOf(doc);
  if (!units || !isObj(doc)) return null;
  const order = Array.isArray(doc.order) ? doc.order.map(str).filter((id) => id in units) : [];
  const ids = [...order, ...Object.keys(units).filter((id) => !order.includes(id))];
  const warnings: string[] = [];
  const edition = str(doc.edition);
  if (edition && !/^(10|11)e$/.test(edition))
    warnings.push(
      `Yellowscribe ${edition} data: weapon skills and some characteristics may need filling in.`,
    );
  const read = ids.map((id) => readUnit(units[id] as YsUnit, suggestBase));
  for (const u of read) if (!u.models.length) warnings.push(`Unit ${u.name} has no models.`);
  const points = read.reduce((n, u) => n + (u.sheet.points ?? 0), 0);
  // Unnamed data goes by its faction, the keyword most of its units share (UX 487); else the file's name.
  const factions = new Map<string, number>();
  for (const id of ids)
    for (const k of (units[id] as YsUnit).factionKeywords ?? []) factions.set(k, (factions.get(k) ?? 0) + 1);
  const faction = [...factions].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    name: str(doc.name) || faction,
    ...(points ? { points } : {}),
    units: read,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");

function profileOut(p: ImportedModel["profile"]): YsProfile {
  const out: YsProfile = { name: p.name };
  for (const [k, v] of Object.entries(p.chars)) out[k === "INV" ? "insv" : k.toLowerCase()] = v;
  return out;
}

function weaponOut(w: WeaponProfile, name: string): YsWeapon {
  const keywords = w.keywords.length ? w.keywords.join(", ") : "-";
  return {
    name,
    range: w.kind === "melee" ? "Melee" : (w.chars.RANGE ?? "-"),
    a: w.chars.A ?? "-",
    bsws: (w.kind === "melee" ? (w.chars.WS ?? w.chars.BS) : (w.chars.BS ?? w.chars.WS)) ?? "-",
    s: w.chars.S ?? "-",
    ap: w.chars.AP ?? "0",
    d: w.chars.D ?? "-",
    number: 1,
    abilities: keywords,
    shortAbilities: keywords,
  };
}

function unitOut(u: ImportedUnit, uuid: string): YsUnit {
  // Weapons by name, as Yellowscribe keys them; a second profile of one name gets its own.
  const names = new Map<string, string>();
  const weapons: Record<string, YsWeapon> = {};
  for (const w of Object.values(u.sheet.weapons)) {
    let name = w.name;
    if (name in weapons) name = `${w.name} (${w.kind})`;
    for (let i = 2; name in weapons; i++) name = `${w.name} (${i})`;
    names.set(w.id, name);
    weapons[name] = weaponOut(w, name);
  }
  // Profiles by name; one name with two sets of characteristics keys the second by id.
  const modelProfiles: Record<string, YsProfile> = {};
  const profileKey = (p: ImportedModel["profile"]) => {
    const out = profileOut(p);
    for (let i = 1; ; i++) {
      const key = i === 1 ? p.name : `${p.name} #${i}`;
      const have = modelProfiles[key];
      if (!have) {
        modelProfiles[key] = out;
        return key;
      }
      if (JSON.stringify(have) === JSON.stringify(out)) return key;
    }
  };
  const abilityNames = u.sheet.abilities.map((a) => a.name);
  const models: Record<string, YsModel> = {};
  let last: { sig: string; model: YsModel } | undefined;
  let n = 0;
  for (const m of u.models) {
    const key = profileKey(m.profile);
    const counts = new Map<string, number>();
    for (const id of m.weapons) {
      const name = names.get(id);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sig = JSON.stringify([key, [...counts]]);
    if (last?.sig === sig) {
      last.model.number! += 1;
      continue;
    }
    const model: YsModel = {
      name: m.profile.name,
      abilities: abilityNames,
      weapons: [...counts].map(([name, number]) => ({ name, number })),
      number: 1,
      ...(key !== m.profile.name ? { profileID: key } : {}),
    };
    models[hex(n++, 16)] = model;
    last = { sig, model };
  }
  const abilities: Record<string, YsAbility> = {};
  for (const a of u.sheet.abilities)
    abilities[a.name] = { name: a.name, desc: a.text, ...(a.group ? { group: a.group } : {}) };
  return {
    name: u.name,
    factionKeywords: [],
    keywords: [...u.sheet.keywords],
    abilities,
    models: { models, totalNumberOfModels: u.models.length },
    modelProfiles,
    weapons,
    rules: [],
    isSingleModel: u.models.length === 1,
    uuid,
    ...(u.sheet.points ? { points: u.sheet.points } : {}),
  };
}

/**
 * A roster as Yellowscribe army data, the JSON its site posts to make a TTS
 * army code. Faction keywords aren't told apart from the rest here, so all go
 * under `keywords`; points and the roster's name ride along as extra fields.
 */
export function toYellowscribe(roster: ImportedRoster, edition = "10e"): YsArmy {
  const units: Record<string, YsUnit> = {};
  const order: string[] = [];
  roster.units.forEach((u, i) => {
    const uuid = hex(i, 8);
    order.push(uuid);
    units[uuid] = unitOut(u, uuid);
  });
  return { edition, order, units, ...(roster.name ? { name: roster.name } : {}) };
}
