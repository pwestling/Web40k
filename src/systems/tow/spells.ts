import type { Spell, SpellKind } from "../../core";
import type { ImportedRoster, ImportedUnit } from "../wh40k/roster";
import { WIZARD_RE } from "./roster";

/**
 * Spell list files: the player's own spells as data (name, casting value,
 * range, kind, and for damage spells hits and Strength), never rules text.
 * A list is `{ "spells": [...] }` or a bare array; docs/old-world-magic.md
 * has the format.
 */

const KINDS: SpellKind[] = ["missile", "vortex", "assailment", "enchantment", "hex", "conveyance"];

/** The spells in a list file, and what was wrong with any that were left out. */
export function parseSpellList(text: string): { spells: Spell[]; problems: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { spells: [], problems: ["This isn't a spell list: it doesn't read as JSON."] };
  }
  const list = Array.isArray(data) ? data : (data as { spells?: unknown })?.spells;
  if (!Array.isArray(list)) return { spells: [], problems: ['A spell list needs a "spells" list.'] };
  const spells: Spell[] = [];
  const problems: string[] = [];
  list.forEach((raw: unknown, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const cv = Number(o.cv ?? o.castingValue);
    const range = Number(o.range ?? 0);
    const kind = String(o.kind ?? "").toLowerCase() as SpellKind;
    const why = !name
      ? "no name"
      : !Number.isFinite(cv) || cv < 2
        ? "no casting value"
        : !Number.isFinite(range) || range < 0
          ? "a bad range"
          : !KINDS.includes(kind)
            ? `a kind that isn't one of ${KINDS.join(", ")}`
            : "";
    if (why) {
      problems.push(`Spell ${i + 1}${name ? ` (${name})` : ""} has ${why}.`);
      return;
    }
    const num = (k: string) =>
      Number.isFinite(Number(o[k])) && o[k] !== undefined ? Number(o[k]) : undefined;
    spells.push({
      name,
      cv,
      range,
      kind,
      ...(o.hits !== undefined ? { hits: String(o.hits) } : {}),
      ...(num("strength") !== undefined ? { strength: num("strength") } : {}),
      ...(num("ap") !== undefined ? { ap: num("ap") } : {}),
      ...(o.remains ? { remains: true } : {}),
      ...(typeof o.lore === "string" && o.lore.trim() ? { lore: o.lore.trim() } : {}),
    });
  });
  return { spells, problems };
}

/** A unit's wizard level as imported, from the sheet or a "Level 2 Wizard" rule. */
export function importedWizard(u: ImportedUnit): number {
  if (u.sheet.wizard) return u.sheet.wizard;
  for (const n of [u.name, ...u.sheet.abilities.map((a) => a.name), ...u.sheet.keywords]) {
    const m = WIZARD_RE.exec(n);
    if (m) return Number(m[1] ?? m[2]);
  }
  return 0;
}

/**
 * Give the roster's wizards spells from a list. A wizard whose list names a
 * lore the file has ("Lore of Herds") gets that lore's spells; one that names
 * none gets them all. Spells it already knows stay.
 */
export function addSpells(
  roster: ImportedRoster,
  spells: Spell[],
): { roster: ImportedRoster; wizards: number } {
  const lores = [...new Set(spells.flatMap((s) => (s.lore ? [s.lore] : [])))];
  let wizards = 0;
  const units = roster.units.map((u) => {
    const level = importedWizard(u);
    if (!level) return u;
    wizards++;
    const known = u.sheet.spells ?? [];
    const text = [
      u.name,
      ...u.sheet.abilities.map((a) => a.name),
      ...u.sheet.keywords,
      ...known.map((k) => k.lore ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    const named = lores.filter((l) => text.includes(l.toLowerCase()));
    const mine = named.length ? spells.filter((s) => s.lore && named.includes(s.lore)) : spells;
    return {
      ...u,
      sheet: {
        ...u.sheet,
        wizard: level,
        spells: [...known, ...mine.filter((s) => !known.some((k) => k.name === s.name))],
      },
    };
  });
  return { roster: { ...roster, units }, wizards };
}
