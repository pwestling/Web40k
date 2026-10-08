import type { Ability, BaseShape, Characteristics, Spell, SpellKind, WeaponProfile } from "../../core";
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

/** Ability groups on the unit card. */
const MOUNT_GROUP = "Mount and crew";
export const ITEM_GROUP = "Magic items and options";
const RULE_GROUP = "Special rules";

/** Unit Strength per model by troop type (the rulebook's Troop Type table, via tow.whfb.app). */
const UNIT_STRENGTH: [RegExp, number | "W"][] = [
  [/monstrous infantry|swarm/i, 3],
  [/monstrous cavalry/i, 3],
  [/light cavalry|heavy cavalry|^cavalry/i, 2],
  [/war beast/i, 1],
  [/light chariot/i, 3],
  [/heavy chariot|chariot/i, 5],
  [/monstrous creature|behemoth|monster|war machine/i, "W"],
  [/infantry/i, 1],
];

export function unitStrengthFor(troop: string | undefined, wounds: string | undefined): number | null {
  const row = UNIT_STRENGTH.find(([re]) => re.test(troop ?? ""));
  if (!row) return null;
  if (row[1] !== "W") return row[1];
  const w = Number(wounds);
  return Number.isFinite(w) && w > 0 ? w : null;
}

const TOW_STATS = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"] as const;

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
    if (!k || c.value === "") continue;
    // Some lists write a skill the model doesn't have (a beast's BS) as 0 rather than "-".
    out[k] = (k === "WS" || k === "BS") && c.value.trim() === "0" ? "-" : c.value;
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

function extractTowUnits(roster: RRoster, warnings: string[]): ImportedUnit[] {
  const sels: RNode[] = [];
  for (const f of roster.forces) collect(f, sels);
  return sels.map((s) => extractUnit(s, warnings));
}

/** Nodes of a selection type ("mount", "crew"), outermost first. */
function nodesOfType(sel: RNode, type: string): RNode[] {
  const out: RNode[] = [];
  walk(sel, (n) => {
    if (n !== sel && n.type === type) out.push(n);
  });
  return out;
}

/** The troop type, from a characteristic, a category or a rule. A mount's (a chariot, a monster) wins over its rider's. */
function troopType(sel: RNode, mounts: RNode[]): string | undefined {
  for (const m of mounts) {
    const t = troopIn(m);
    if (t) return t;
  }
  return troopIn(sel);
}

function troopIn(sel: RNode): string | undefined {
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

/** "25x50" in a Base Size characteristic; in rules text only with "mm" ("a 25x50mm base"). */
const SIZE_RE = /(\d{2,3})\s*(?:mm)?\s*[x×]\s*(\d{2,3})/i;
const BASE_RE = /(\d{2,3})\s*(?:mm)?\s*[x×]\s*(\d{2,3})\s*mm/i;

/** The base the roster names: a mount's (a chariot, a monster) before its rider's. */
function baseOf(sel: RNode, mounts: RNode[], troop: string | undefined): BaseShape {
  for (const n of [...mounts, sel]) {
    const b = baseIn(n);
    if (b) return b;
  }
  return baseForTroop(troop);
}

function baseIn(sel: RNode): BaseShape | undefined {
  let found: BaseShape | undefined;
  const take = (m: RegExpExecArray | null) => {
    if (m) found = { shape: "rect", widthMm: Number(m[1]), depthMm: Number(m[2]) };
    return !!m;
  };
  walk(sel, (n) => {
    if (found) return;
    for (const p of n.profiles)
      for (const c of p.chars) if (/base/i.test(c.name) && take(SIZE_RE.exec(c.value))) return;
    for (const r of n.rules) if (/base/i.test(`${r.name} ${r.text}`) && take(BASE_RE.exec(r.text))) return;
  });
  return found;
}

/** A sensible default base by troop type; players can change it on import. */
function baseForTroop(troop: string | undefined): BaseShape {
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

const SPELL_KINDS: [RegExp, SpellKind][] = [
  [/missile/i, "missile"],
  [/vortex/i, "vortex"],
  [/assail/i, "assailment"],
  [/enchant|augment/i, "enchantment"],
  [/hex|curse/i, "hex"],
  [/convey|movement/i, "conveyance"],
];

/** A spell: a profile with a casting value. Its name, numbers and kind only, never its text. */
function spellOf(p: RProfile): Spell | undefined {
  const get = (re: RegExp) => p.chars.find((c) => re.test(c.name))?.value ?? "";
  const cv = Number.parseInt(get(/casting\s*value|^cv$/i), 10);
  if (!Number.isFinite(cv)) return undefined;
  const range = Number.parseFloat(get(/range/i)) || 0;
  const typed = `${get(/type|kind/i)} ${p.typeName}`;
  const kind = SPELL_KINDS.find(([re]) => re.test(typed))?.[1] ?? "enchantment";
  return { name: p.name.replace(/^\s*(➤|>|-)\s*/, "").trim(), cv, range, kind };
}

/** "Level 2 Wizard", "Wizard (Level 3)": the level, from a selection or rule name. */
export const WIZARD_RE = /level\s*(\d)\s*wizard|wizard\s*\(?\s*level\s*(\d)/i;

function extractUnit(sel: RNode, warnings: string[]): ImportedUnit {
  // Mounts and crew are their own selection types in the community catalogues.
  const mountNodes = nodesOfType(sel, "mount");
  const crewNodes = nodesOfType(sel, "crew");
  const troop = troopType(sel, mountNodes);
  const groups = sel.type === "model" ? [sel] : modelGroups(sel);
  const command: RNode[] = [];
  // A magic standard ("Banner of …") has rules of its own, and sits under its bearer.
  // (A Battle Standard Bearer is a character's upgrade, not another model.)
  const isCommand = (n: RNode) =>
    n.type === "upgrade" &&
    COMMAND_RE.test(n.name) &&
    !/magic|battle/i.test(n.name) &&
    !n.rules.length &&
    n.profiles.every((p) => isStatProfile(p) || /command/i.test(p.typeName));
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
  const apart = new Set([...commandSet, ...mountNodes, ...crewNodes]);
  const fill = (g: RNode, count: number) => {
    const own = statProfileIn(g, apart) ?? statProfileIn(sel, apart);
    const chars: Characteristics = own ? statsOf(own) : {};
    // Rosters without mount selections: a second model profile with another name is the mount.
    if (!mountNodes.length)
      walk(g, (n) => {
        if (apart.has(n)) return;
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

  for (const n of mountNodes)
    walk(n, (x) => {
      for (const p of x.profiles) if (isStatProfile(p) && !mounts.has(p.name)) mounts.set(p.name, p);
    });
  // A mount carries its rider: the model moves at the mount's Movement (a chariot at its beasts').
  const mountName = mountNodes[0]?.name ?? [...mounts.keys()][0];
  if (mountName) {
    const move = [...mounts.values()].map((p) => statsOf(p).M).find((v) => v && /\d/.test(v));
    // A chariot or monster written as "W (+4)" adds its Wounds to the rider's and lends its Toughness.
    const bigMount = [...mounts.values()].map(statsOf).find((st) => /^\(\+\d+\)$/.test(st.W ?? ""));
    for (const m of models) {
      if (move) m.profile.chars.M = move;
      m.profile.chars.Mount = mountName;
      if (!bigMount) continue;
      const own = Number(m.profile.chars.W);
      if (Number.isFinite(own)) m.profile.chars.W = String(own + Number(/\d+/.exec(bigMount.W!)![0]));
      // The higher of the rider's and the mount's Toughness is used (tow.whfb.app, split profile).
      const t = Math.max(Number(m.profile.chars.T) || 0, Number(bigMount.T) || 0);
      if (t) m.profile.chars.T = String(t);
    }
  }
  for (const n of crewNodes)
    walk(n, (x) => {
      for (const p of x.profiles) if (isStatProfile(p) && !mounts.has(p.name)) mounts.set(p.name, p);
    });
  // Mount and crew profiles stay readable on the unit card.
  for (const p of mounts.values())
    addAbility({
      name: p.name,
      text: Object.entries(statsOf(p))
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
      group: MOUNT_GROUP,
    });

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
  // Unit Strength per model from the troop type table; monsters and war machines count their Wounds.
  for (const m of models)
    if (!m.profile.chars.US) {
      const us = unitStrengthFor(m.profile.chars.Troop, m.profile.chars.W);
      if (us) m.profile.chars.US = String(us);
    }

  // Weapons go to every model; rules, magic items and options become abilities.
  const weapons: Record<string, WeaponProfile> = {};
  const carried: string[] = [];
  let points = 0;
  const keywords: string[] = [];
  const spells: Spell[] = [];
  let wizard = 0;
  walk(sel, (n) => {
    points += n.pts;
    for (const name of [n.name, ...n.rules.map((r) => r.name)]) {
      const m = WIZARD_RE.exec(name);
      if (m) wizard = Math.max(wizard, Number(m[1] ?? m[2]));
    }
    for (const p of n.profiles) {
      const spell = spellOf(p);
      // A spell's text (the player's own) still shows on the unit card.
      if (spell && !spells.some((s) => s.name === spell.name))
        spells.push(/\blore\b/i.test(n.name) ? { ...spell, lore: n.name } : spell);
      // Stat lines, the unit's troop type and size, bases and command are read elsewhere.
      if (isStatProfile(p) || /^(unit|base|command)$/i.test(p.typeName)) continue;
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
        group: n !== sel && n.pts > 0 ? ITEM_GROUP : RULE_GROUP,
      });
    }
    for (const r of n.rules) addAbility({ ...r, group: n !== sel && n.pts > 0 ? ITEM_GROUP : RULE_GROUP });
    // Magic items and options with no rules text of their own still show by name.
    if (
      n !== sel &&
      n.type === "upgrade" &&
      !commandSet.has(n) &&
      n.pts > 0 &&
      !n.profiles.length &&
      !n.rules.length
    )
      addAbility({ name: n.name, text: `${n.pts} pts`, group: ITEM_GROUP });
    for (const c of n.categories) if (c && !keywords.includes(c)) keywords.push(c);
  });
  for (const m of models) m.weapons = [...carried];

  const first = models[0]?.profile.chars ?? {};
  const missing: string[] = TOW_STATS.filter((k) => !first[k]);
  if (!troop) missing.push("Troop");

  const unit: ImportedUnit = {
    name: sel.name,
    sheet: {
      weapons,
      abilities,
      keywords,
      ...(points > 0 ? { points } : {}),
      ...(wizard || spells.length ? { wizard: wizard || 1, spells } : {}),
    },
    models,
    base: baseOf(sel, mountNodes, troop),
  };
  if (missing.length) unit.missing = missing;
  return unit;
}
