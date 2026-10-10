import type { ImportedModel, ImportedRoster, ImportedUnit } from "../systems/wh40k/roster";

/**
 * An army from a TTS save, with a roster file for its rules (#74). The roster
 * (.ros/.rosz/.json) is the better source for stats, points, enhancements and
 * the detachment; the save is the source for which models are on the table
 * and where. So each TTS unit is matched to a roster unit by name, takes the
 * roster unit's name, sheet and base, and each of its models keeps everything
 * the save gave it (position, figure, …) but takes a roster model's profile
 * and weapons: the one of the same name if there is one, else the next in
 * order, cycling when the table has more models than the list. Unmatched TTS
 * units stay as read from their descriptions; unmatched roster units are
 * added after them, to be placed like any imported unit.
 */

interface MergeResult {
  roster: ImportedRoster;
  /** TTS unit names that found a roster unit. */
  matched: number;
  /** TTS units the roster doesn't have, kept as the save describes them. */
  ttsOnly: string[];
  /** Roster units not on the TTS table, added to the army. */
  rosterOnly: string[];
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(the|squad|unit|team|band|pack|x?\d+x?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/s\b/g, "");

/** 3 for the same name, 2 when one holds the other, 1 for most words shared, 0 for none. */
export function nameScore(a: string, b: string): number {
  const [x, y] = [key(a), key(b)];
  if (!x || !y) return 0;
  if (x === y) return 3;
  if (x.includes(y) || y.includes(x)) return 2;
  const xs = new Set(x.split(" "));
  const ys = y.split(" ");
  const shared = ys.filter((w) => xs.has(w)).length;
  return shared / Math.max(xs.size, ys.length) >= 0.5 ? 1 : 0;
}

export function mergeWithRoster(tts: ImportedRoster, list: ImportedRoster): MergeResult {
  const used = new Set<number>();
  const ttsOnly: string[] = [];
  const warnings = [...tts.warnings];
  let matched = 0;
  const units: ImportedUnit[] = tts.units.map((u) => {
    let best = -1;
    let bestScore = 0;
    list.units.forEach((r, i) => {
      if (used.has(i)) return;
      const s = nameScore(u.name, r.name);
      const closer =
        s === bestScore &&
        best >= 0 &&
        Math.abs(r.models.length - u.models.length) <
          Math.abs(list.units[best]!.models.length - u.models.length);
      if (s > bestScore || closer) {
        best = i;
        bestScore = s;
      }
    });
    if (best < 0) {
      ttsOnly.push(u.name);
      return u;
    }
    used.add(best);
    matched++;
    const r = list.units[best]!;
    if (r.models.length !== u.models.length)
      warnings.push(
        `${r.name}: ${u.models.length} models on the TTS table, ${r.models.length} in the list; the table's count is used.`,
      );
    const merged: ImportedUnit = {
      ...u,
      name: r.name,
      sheet: r.sheet,
      base: r.base,
      models: dealModels(u.models, r.models),
    };
    if (r.missing) merged.missing = r.missing;
    else delete merged.missing;
    if (r.files) merged.files = r.files;
    return merged;
  });
  const rosterOnly = list.units.filter((_, i) => !used.has(i));
  units.push(...rosterOnly);
  return {
    roster: {
      ...tts,
      name: list.name || tts.name,
      ...(list.points !== undefined ? { points: list.points } : {}),
      ...(list.army ? { army: list.army } : {}),
      ...(list.color && !tts.color ? { color: list.color } : {}),
      units,
      warnings: [...warnings, ...list.warnings],
    },
    matched,
    ttsOnly,
    rosterOnly: rosterOnly.map((u) => u.name),
  };
}

/** Each table model keeps what it has and takes a list model's profile and weapons. */
function dealModels(table: ImportedModel[], list: ImportedModel[]): ImportedModel[] {
  if (!list.length) return table;
  const taken = new Set<number>();
  const pick = (name: string) => {
    let i = list.findIndex((m, j) => !taken.has(j) && key(m.profile.name) === key(name));
    if (i < 0) i = list.findIndex((_, j) => !taken.has(j));
    if (i < 0) {
      // More models on the table than in the list: reuse the plainest (most common) profile.
      taken.clear();
      i = list.length - 1;
    }
    taken.add(i);
    return list[i]!;
  };
  return table.map((m) => {
    const r = pick(m.profile.name);
    return {
      ...m,
      profile: { name: r.profile.name, chars: { ...r.profile.chars } },
      weapons: [...r.weapons],
      ...(r.base ? { base: r.base } : {}),
    };
  });
}
