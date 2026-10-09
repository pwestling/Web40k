import type { BaseShape } from "../../core";
import type { ImportedRoster, ImportedUnit } from "../wh40k/roster";

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

export async function importConquestList(fileName: string, data: Uint8Array): Promise<ImportedRoster> {
  return parseConquestList(new TextDecoder().decode(data), fileName);
}
