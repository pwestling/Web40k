import type { Ability, BaseShape, Characteristics, WeaponProfile } from "../../core";
import {
  modelGroups,
  parseRosterFile,
  walk,
  type ImportedModel,
  type ImportedRoster,
  type ImportedUnit,
  type RForce,
  type RNode,
  type RProfile,
  type RRoster,
} from "../wh40k/roster";

/**
 * Old World army lists: BattleScribe / New Recruit rosters built on the
 * community catalogues, read with the same parser as 40k and mapped to the
 * Old World profile (M WS BS S T W I A Ld, troop type), with mounts, command
 * models, magic items and points.
 *
 * The mapping goes by characteristic names rather than profile type names, so
 * it copes with catalogue revisions; anything it can't find is listed in
 * `missing` for the player to fill in.
 */
export function importTowRoster(fileName: string, data: Uint8Array): Promise<ImportedRoster> {
  return parseRosterFile(fileName, data, extractTowUnits);
}

export const TOW_STATS = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"] as const;

const STAT_KEYS: Record<string, string> = {
  M: "M",
  MOVE: "M",
  MOVEMENT: "M",
  WS: "WS",
  WEAPONSKILL: "WS",
  BS: "BS",
  BALLISTICSKILL: "BS",
  S: "S",
  STRENGTH: "S",
  T: "T",
  TOUGHNESS: "T",
  W: "W",
  WOUNDS: "W",
  I: "I",
  INITIATIVE: "I",
  A: "A",
  ATTACKS: "A",
  LD: "Ld",
  LEADERSHIP: "Ld",
};

const key = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");

function statsOf(p: RProfile): Characteristics {
  const out: Characteristics = {};
  for (const c of p.chars) {
    const k = STAT_KEYS[key(c.name)];
    if (k && c.value !== "") out[k] = c.value;
  }
  return out;
}

/** A model's profile: one carrying most of the Old World characteristics. */
const isStatProfile = (p: RProfile) => Object.keys(statsOf(p)).length >= 5;

const TROOP_RE =
  /\b((?:regular|heavy|monstrous|light)\s+infantry|(?:light|heavy|monstrous)\s+cavalry|(?:light|heavy)\s+chariots?|monstrous\s+creatures?|war\s+beasts?|war\s+machines?|swarms?|behemoths?|monsters?)\b/i;

/** Command models: they stand in the front rank, in this order. */
const COMMAND_RE =
  /\b(champion|sergeant|standard(?:\s+bearer)?|banner(?:\s+bearer)?|musician|drummer|hornblower|bugler|trumpeter)\b/i;

const statProfileIn = (node: RNode, skip: Set<RNode> = new Set()): RProfile | undefined => {
  const queue = [node];
  for (let n = queue.shift(); n; n = queue.shift()) {
    if (skip.has(n)) continue;
    const p = n.profiles.find(isStatProfile);
    if (p) return p;
    queue.push(...n.selections);
  }
  return undefined;
};

function collect(force: RForce, out: RNode[]): void {
  for (const sel of force.selections) {
    if (sel.type === "upgrade") continue;
    if (statProfileIn(sel)) out.push(sel);
  }
  for (const f of force.forces) collect(f, out);
}

export function extractTowUnits(roster: RRoster, warnings: string[]): ImportedUnit[] {
  const sels: RNode[] = [];
  for (const f of roster.forces) collect(f, sels);
  return sels.map((s) => extractUnit(s, warnings));
}

/** The troop type, from a characteristic, a category or a rule. */
function troopType(sel: RNode): string | undefined {
  let found: string | undefined;
  walk(sel, (n) => {
    if (found) return;
    for (const p of n.profiles)
      for (const c of p.chars)
        if (/troop|^type$/i.test(c.name) && c.value) {
          found = c.value;
          return;
        }
    for (const t of [...n.categories, ...n.rules.map((r) => r.name)]) {
      const m = TROOP_RE.exec(t);
      if (m) {
        found = m[1];
        return;
      }
    }
  });
  return found && titleCase(found);
}

function titleCase(s: string): string {
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

const BASE_RE = /(\d{2,3})\s*(?:mm)?\s*[x×]\s*(\d{2,3})\s*mm/i;

function baseOf(sel: RNode, troop: string | undefined): BaseShape {
  let found: BaseShape | undefined;
  walk(sel, (n) => {
    if (found) return;
    const texts = [
      ...n.profiles.flatMap((p) => p.chars.map((c) => `${c.name} ${c.value}`)),
      ...n.rules.map((r) => `${r.name} ${r.text}`),
    ];
    for (const t of texts) {
      if (!/base/i.test(t)) continue;
      const m = BASE_RE.exec(t);
      if (m) {
        found = { shape: "rect", widthMm: Number(m[1]), depthMm: Number(m[2]) };
        return;
      }
    }
  });
  return found ?? baseForTroop(troop);
}

/** A sensible default base by troop type; players can change it on import. */
export function baseForTroop(troop: string | undefined): BaseShape {
  const t = troop ?? "";
  const rect = (w: number, d: number): BaseShape => ({ shape: "rect", widthMm: w, depthMm: d });
  if (/heavy infantry/i.test(t)) return rect(25, 25);
  if (/monstrous infantry/i.test(t)) return rect(40, 40);
  if (/monstrous cavalry/i.test(t)) return rect(50, 75);
  if (/cavalry/i.test(t)) return rect(25, 50);
  if (/chariot/i.test(t)) return rect(50, 100);
  if (/war beast/i.test(t)) return rect(25, 50);
  if (/swarm/i.test(t)) return rect(40, 40);
  if (/war machine/i.test(t)) return rect(50, 50);
  if (/monster|behemoth|creature/i.test(t)) return rect(50, 100);
  return rect(20, 20);
}

/** Weapons: a profile whose type names a weapon. A range in inches makes it a missile weapon. */
function weaponOf(p: RProfile): Omit<WeaponProfile, "id"> | undefined {
  if (!/weapon/i.test(p.typeName)) return undefined;
  const chars: Characteristics = {};
  let keywords: string[] = [];
  for (const c of p.chars) {
    const k = key(c.name);
    if (k === "R" || k === "RANGE" || k === "RNG") chars.Range = c.value;
    else if (k === "S" || k === "STRENGTH") chars.S = c.value;
    else if (k === "AP" || k === "ARMOURPIERCING" || k === "ARMORPIERCING") chars.AP = c.value;
    else if (/special|rules|notes/i.test(c.name))
      keywords = c.value
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s && s !== "-");
  }
  const ranged = /\d/.test(chars.Range ?? "");
  return {
    name: p.name.replace(/^\s*(➤|>|-)\s*/, "").trim(),
    kind: ranged ? "ranged" : "melee",
    chars,
    keywords,
  };
}

function extractUnit(sel: RNode, warnings: string[]): ImportedUnit {
  const troop = troopType(sel);
  const groups = sel.type === "model" ? [sel] : modelGroups(sel);
  const command: RNode[] = [];
  // A magic standard ("Banner of …") has rules of its own, and sits under its bearer.
  const isCommand = (n: RNode) =>
    n.type === "upgrade" && COMMAND_RE.test(n.name) && !n.rules.length && n.profiles.every(isStatProfile);
  const findCommand = (n: RNode) => {
    for (const c of n.selections) {
      if (isCommand(c)) command.push(c);
      else findCommand(c);
    }
  };
  findCommand(sel);
  const commandSet = new Set(command);

  // Rank and file (or the single model), and any mount: a second model profile with another name.
  const models: ImportedModel[] = [];
  const mounts = new Map<string, RProfile>();
  const fill = (g: RNode, count: number) => {
    const own = statProfileIn(g, commandSet) ?? statProfileIn(sel, commandSet);
    const chars: Characteristics = own ? statsOf(own) : {};
    walk(g, (n) => {
      if (commandSet.has(n)) return;
      for (const p of n.profiles)
        if (isStatProfile(p) && p !== own && p.name !== own?.name && !mounts.has(p.name))
          mounts.set(p.name, p);
    });
    for (let i = 0; i < count; i++)
      models.push({ profile: { name: own?.name || g.name, chars: { ...chars } }, weapons: [] });
  };
  if (groups.length) for (const g of groups) fill(g, g.number);
  else fill(sel, 1);
  if (!models.length) warnings.push(`Unit ${sel.name} has no models.`);

  const abilities: Ability[] = [];
  const seen = new Set<string>();
  const addAbility = (a: Ability) => {
    const k = a.name.toLowerCase();
    if (!a.name || seen.has(k)) return;
    seen.add(k);
    abilities.push(a);
  };

  // A mount carries its rider: the model moves at the mount's Movement.
  const mount = [...mounts.values()][0];
  if (mount) {
    const ms = statsOf(mount);
    for (const m of models) {
      if (ms.M && ms.M !== "-") m.profile.chars.M = ms.M;
      m.profile.chars.Mount = mount.name;
    }
    for (const p of mounts.values())
      addAbility({
        name: p.name,
        text: Object.entries(statsOf(p))
          .map(([k, v]) => `${k} ${v}`)
          .join(", "),
      });
  }

  // Command models take the front slots, with their own profile when the roster gives one.
  command.slice(0, models.length).forEach((c, i) => {
    const m = models[i]!;
    const own = statProfileIn(c);
    m.profile = {
      name: c.name,
      chars: own ? { ...m.profile.chars, ...statsOf(own) } : m.profile.chars,
    };
  });

  if (troop) for (const m of models) m.profile.chars.Troop = troop;

  // Weapons go to every model; rules, magic items and options become abilities.
  const weapons: Record<string, WeaponProfile> = {};
  const carried: string[] = [];
  let points = 0;
  const keywords: string[] = [];
  walk(sel, (n) => {
    points += n.pts;
    for (const p of n.profiles) {
      if (isStatProfile(p)) continue;
      const w = weaponOf(p);
      if (w) {
        let id = w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "weapon";
        if (weapons[id] && JSON.stringify(weapons[id]) !== JSON.stringify({ id, ...w }))
          id = `${id}-${w.kind}`;
        if (!weapons[id]) {
          weapons[id] = { id, ...w };
          carried.push(id);
        }
        continue;
      }
      const desc = p.chars.find((c) => /^description|^text|^effect/i.test(c.name));
      addAbility({
        name: p.name,
        text: desc
          ? desc.value
          : p.chars
              .filter((c) => c.value)
              .map((c) => `${c.name}: ${c.value}`)
              .join("; "),
      });
    }
    for (const r of n.rules) addAbility(r);
    // Magic items and options with no rules text of their own still show by name.
    if (
      n !== sel &&
      n.type === "upgrade" &&
      !commandSet.has(n) &&
      n.pts > 0 &&
      !n.profiles.length &&
      !n.rules.length
    )
      addAbility({ name: n.name, text: `${n.pts} pts` });
    for (const c of n.categories) if (c && !keywords.includes(c)) keywords.push(c);
  });
  for (const m of models) m.weapons = [...carried];

  const first = models[0]?.profile.chars ?? {};
  const missing: string[] = TOW_STATS.filter((k) => !first[k]);
  if (!troop) missing.push("Troop");

  const unit: ImportedUnit = {
    name: sel.name,
    sheet: { weapons, abilities, keywords, ...(points > 0 ? { points } : {}) },
    models,
    base: baseOf(sel, troop),
  };
  if (missing.length) unit.missing = missing;
  return unit;
}
