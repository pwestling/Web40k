import type { BaseShape } from "../../core";
import {
  parseRosterFile,
  walk,
  type ImportedRoster,
  type ImportedUnit,
  type RForce,
  type RNode,
  type RProfile,
  type RRoster,
} from "../wh40k/roster";
import { standBase } from "./sample";
import { standOf } from "./stands";

/**
 * Conquest army lists as shared in text (research/conquest-rules.md, Lists):
 * a character on a line starting "==", each regiment it leads on a line
 * starting "*":
 *
 *     == Name [pts]: upgrades
 *     * Regiment (stands) [pts]: options
 *
 * The format is the notes' best guess at the official builder's (unconfirmed),
 * and it carries no profiles: each unit comes in with its stands, points and
 * options, and the player fills in the characteristics before deploying.
 * Options become abilities by name, so special rules the engine knows are found.
 */

/** Characteristics the list leaves out, for the player to fill in (the import panel asks). */
const CONQUEST_STATS = ["M", "V", "C", "A", "W", "R", "D", "Type", "Class"];

/** A stand's base until the player sets the type: an unverified guess, as the samples use. */
const STAND: BaseShape = { shape: "rect", widthMm: 40, depthMm: 40 };

const LINE = /^(==|\*)\s*(.+?)\s*(?:\((\d+)\))?\s*(?:\[(\d+)(?:\s*pts)?\])?\s*(?::\s*(.*))?$/i;

/** One unit from a list line, or null for a line that isn't one. */
function unitOf(line: string): ImportedUnit | null {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const character = m[1] === "==";
  const name = m[2]!.trim();
  const stands = character ? 1 : Math.max(1, Number(m[3] ?? 1));
  const points = m[4] ? Number(m[4]) : undefined;
  const options = (m[5] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // The command stand in the centre of the front rank (three wide or fewer).
  const command = Math.floor((Math.min(3, stands) - 1) / 2);
  const chars: Record<string, string> = character ? { Type: "Character" } : {};
  return {
    name,
    base: STAND,
    sheet: {
      weapons: {},
      abilities: options.map((o) => ({ name: o, text: "" })),
      keywords: character ? ["Character"] : [],
      ...(points !== undefined ? { points } : {}),
    },
    models: Array.from({ length: stands }, (_, i) => ({
      profile: { name: i === command && stands > 1 ? `${name} command` : name, chars: { ...chars } },
      weapons: [],
    })),
    missing: CONQUEST_STATS.filter((k) => !(k in chars)),
    ...(stands > 1 ? { files: Math.min(3, stands) } : {}),
  };
}

/** Read a list shared as text. Throws when no line reads as a character or regiment. */
export function parseConquestList(text: string, fileName = "list"): ImportedRoster {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const units = lines.flatMap((l) => {
    const u = unitOf(l);
    return u ? [u] : [];
  });
  if (!units.length)
    throw new Error(
      `${fileName}: no Conquest list lines found (a character on "== Name [pts]", its regiments on "* Name (stands) [pts]")`,
    );
  const title = lines.find((l) => l && !/^(==|\*)/.test(l));
  return {
    name: title ?? fileName.replace(/\.[^.]+$/, ""),
    points: units.reduce((t, u) => t + (u.sheet.points ?? 0), 0),
    units,
    warnings: [
      "Read as Conquest's shared list text (the format is unconfirmed). Fill in each regiment's characteristics, type and class.",
    ],
  };
}

/**
 * BattleScribe / New Recruit rosters (#66), built on the community catalogue:
 * each regiment or character with its profile (Type, Class, M V C A W R D E,
 * Stands) and its special rules by name ("Cleave 1", "Barrage 2 (24")"),
 * read with the same parser as 40k and the Old World.
 */
const STAT_NAMES = ["Type", "Class", "M", "V", "C", "A", "W", "R", "D", "E"];

/** A regiment's or character's profile: one carrying the roll-under characteristics. */
const isStatProfile = (p: RProfile) => ["M", "C", "D", "R"].every((k) => p.chars.some((c) => c.name === k));

function collect(force: RForce, out: { node: RNode; profile: RProfile }[]): void {
  for (const sel of force.selections) {
    if (sel.type === "upgrade") continue;
    let profile: RProfile | undefined;
    walk(sel, (n) => (profile ??= n.profiles.find(isStatProfile)));
    if (profile) out.push({ node: sel, profile });
  }
  for (const f of force.forces) collect(f, out);
}

function extractConquestUnits(roster: RRoster): ImportedUnit[] {
  const found: { node: RNode; profile: RProfile }[] = [];
  for (const f of roster.forces) collect(f, found);
  return found.map(({ node, profile }) => {
    const chars: Record<string, string> = {};
    for (const c of profile.chars) if (STAT_NAMES.includes(c.name) && c.value !== "") chars[c.name] = c.value;
    chars.Size = String(standOf(chars.Type).size);
    const character = node.type === "model" || /character/i.test(profile.typeName);
    // Bought stands: the profile's count, plus each "Additional Stands" pick.
    let stands = character
      ? 1
      : Math.max(1, Number.parseInt(profile.chars.find((c) => c.name === "Stands")?.value ?? "1", 10) || 1);
    const abilities: { name: string; text: string }[] = [];
    walk(node, (n) => {
      if (n !== node && /additional stand/i.test(n.name)) stands += n.number || 1;
      for (const r of n.rules)
        if (!abilities.some((a) => a.name === r.name)) abilities.push({ name: r.name, text: r.text });
    });
    // Barrage's shots and range on the profile too, for what reads the profile alone (the bot's reach).
    const barrage = abilities
      .map((a) => /^barrage\s*\(?\s*(\d+)\)?\s*\(\s*(\d+)/i.exec(a.name))
      .find(Boolean);
    if (barrage) Object.assign(chars, { Barrage: barrage[1]!, Range: `${barrage[2]}"` });
    const command = Math.floor((Math.min(3, stands) - 1) / 2);
    return {
      name: node.name,
      base: standBase(chars.Type),
      sheet: {
        weapons: {},
        abilities,
        keywords: [
          ...(character ? ["Character"] : []),
          ...[chars.Type, chars.Class].filter((k): k is string => !!k),
        ],
        ...(node.pts ? { points: node.pts } : {}),
      },
      models: Array.from({ length: stands }, (_, i) => ({
        profile: {
          name: i === command && stands > 1 ? `${node.name} command` : node.name,
          chars: { ...chars },
        },
        weapons: [],
      })),
      missing: STAT_NAMES.filter((k) => !(k in chars)),
      ...(stands > 1 ? { files: Math.min(3, stands) } : {}),
    };
  });
}

/** A roster file (XML, JSON or zipped) rather than list text. */
function isRosterFile(fileName: string, data: Uint8Array): boolean {
  if (/\.(ros|rosz|json|xml)$/i.test(fileName)) return true;
  if (data[0] === 0x50 && data[1] === 0x4b) return true;
  const head = new TextDecoder().decode(data.subarray(0, 64)).trim();
  return head.startsWith("<") || head.startsWith("{");
}

export async function importConquestList(fileName: string, data: Uint8Array): Promise<ImportedRoster> {
  if (isRosterFile(fileName, data)) return parseRosterFile(fileName, data, extractConquestUnits);
  return parseConquestList(new TextDecoder().decode(data), fileName);
}
