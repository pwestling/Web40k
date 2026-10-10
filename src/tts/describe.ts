import type { Ability, Characteristics, WeaponProfile } from "../core";

/**
 * Datasheets written into Tabletop Simulator descriptions (#74). Many TTS army
 * mods carry each model's profile in its Description, in the shapes the
 * popular roster converters write: a header row of characteristics with the
 * values on the next line, weapon rows (Range, A, BS or WS, S, AP, D, then
 * keywords), abilities by name or "Name: text", all wrapped in BBCode colour
 * tags. This reads any of those, tolerantly: a line it can't place is kept in
 * `unparsed`, never guessed at. Pure: no rules text is stored, the text is the
 * player's own save.
 */

/** What one description says about a model and its unit. */
export interface TtsProfile {
  /** Unit characteristics with the import's keys (M, T, SV, W, LD, OC, INV). */
  chars: Characteristics;
  weapons: Omit<WeaponProfile, "id">[];
  abilities: Ability[];
  keywords: string[];
  points?: number;
  /** Lines it could not read, for coverage. */
  unparsed: string[];
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** BBCode TTS draws: [b] [/i] [sup], colours [ff0000] [ff0000cc], and [-]. Weapon keywords in [brackets] stay. */
const BBCODE = /\[(?:\/?(?:b|i|u|s|sub|sup|url(?:=[^\]]*)?)|\/?[0-9a-f]{6}(?:[0-9a-f]{2})?|-)\]/gi;

/** The description as plain lines: markup gone, quotes and dashes made plain. */
export function descriptionLines(raw: string): string[] {
  return raw
    .replace(BBCODE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[“”″]|''/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/\u00a0|\t/g, " ")
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, "  ").trim())
    .filter((l) => l !== "");
}

/** A model's name from its TTS nickname: no markup, wound counters ("2/2") or counts ("x5"). */
export function cleanName(raw: string): string {
  return raw
    .replace(BBCODE, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/^\s*\d+\s*x\s+|\s+x\s*\d+\s*$/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:|,]+|[\s\-:|,]+$/g, "");
}

// ---------------------------------------------------------------------------
// Characteristics
// ---------------------------------------------------------------------------

const UNIT_KEYS: Record<string, string> = {
  M: "M",
  MV: "M",
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
  // Older editions' lines: read, kept under their own names.
  WS: "WS",
  BS: "BS",
  S: "S",
  A: "A",
};

const WEAPON_KEYS: Record<string, string> = {
  RANGE: "RANGE",
  RNG: "RANGE",
  R: "RANGE",
  A: "A",
  ATK: "A",
  ATTACKS: "A",
  BS: "BS",
  WS: "WS",
  SKILL: "SKILL",
  S: "S",
  STR: "S",
  STRENGTH: "S",
  AP: "AP",
  D: "D",
  DMG: "D",
  DAMAGE: "D",
  KEYWORDS: "KEYWORDS",
  ABILITIES: "KEYWORDS",
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/** Cells of a row: split on bars, two spaces, tabs, or single spaces between short tokens. */
function cells(line: string): string[] {
  return line
    .split(/\s*\|\s*|\s{2,}|\s*,\s*|\s+/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/** A header row of unit characteristics: every cell a characteristic, with M and T or W among them. */
function unitHeader(line: string): string[] | null {
  const keys = cells(line).map((c) => UNIT_KEYS[norm(c)] ?? "");
  if (keys.length < 3 || keys.some((k) => !k)) return null;
  if (!keys.includes("M") || !(keys.includes("T") || keys.includes("W"))) return null;
  return keys;
}

const VALUE = /^(?:\d+(?:\.\d+)?"?\+?|\d*D\d+(?:\+\d+)?"?|-|\*|N\/A)$/i;

/** "M 6" T 4 SV 3+ W 2 LD 6+ OC 2", with or without colons and bars. */
function inlineUnitChars(line: string): Characteristics | null {
  const re = /\b(M|MV|Move|T|SV|Save|W|LD|OC|INV|InvSv)\s*[:=]?\s*(\d+(?:\.\d+)?"?\+?|-)(?=\s|\||,|;|$)/gi;
  const out: Characteristics = {};
  for (const m of line.matchAll(re)) out[UNIT_KEYS[norm(m[1]!)]!] = m[2]!;
  return out.M && (out.T || out.W) && Object.keys(out).length >= 3 ? out : null;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const RANGE = /^(?:\d+(?:\.\d+)?(?:"|in|")|melee|-)$/i;
const ROLLS = /^(?:\d+|\d*D\d+(?:\s*\+\s*\d+)?)$/i;
const SKILL = /^(?:\d\+|N\/A|-)$/i;
const STR = /^(?:\d+|\d*D\d+(?:\+\d+)?|user|x\d|\+\d)$/i;
const AP = /^(?:0|-\d|\+?\d|-)$/;

/** The six stat cells of a weapon row, from position `i`; null unless all fit. */
function statsAt(t: string[], i: number, bareRange: boolean): string[] | null {
  const six = t.slice(i, i + 6);
  if (six.length < 6) return null;
  const [r, a, sk, s, ap, d] = six as [string, string, string, string, string, string];
  const range = RANGE.test(r) || (bareRange && /^\d+$/.test(r));
  if (!(range && ROLLS.test(a) && SKILL.test(sk) && STR.test(s) && AP.test(ap) && ROLLS.test(d))) return null;
  return /^\d+$/.test(r) ? [`${r}"`, a, sk, s, ap, d] : six;
}

/** Keywords written after a weapon: "[Assault, Heavy]", "Assault, Heavy" or "Keywords: Assault". */
function keywordsOf(rest: string): string[] {
  return rest
    .replace(/^\s*(?:keywords|abilities)\s*:\s*/i, "")
    .replace(/[[\]]/g, ",")
    .split(/[,;|]/)
    .map((k) => k.trim())
    .filter((k) => k !== "" && k !== "-");
}

type Kind = "ranged" | "melee";

function weapon(
  name: string,
  [range, a, skill, s, ap, d]: string[],
  rest: string,
  hint: Kind | undefined,
  skillKey?: string,
): Omit<WeaponProfile, "id"> {
  const melee = /^melee$/i.test(range!) || skillKey === "WS" || (hint === "melee" && !/\d/.test(range!));
  const kind: Kind = melee ? "melee" : "ranged";
  const chars: Characteristics = {
    RANGE: kind === "melee" ? "Melee" : range!,
    A: a!.replace(/\s+/g, ""),
    [kind === "melee" ? "WS" : "BS"]: skill!,
    S: s!,
    AP: ap === "-" ? "0" : ap!,
    D: d!.replace(/\s+/g, ""),
  };
  return { name: name.replace(/[:\-–|]+\s*$/, "").trim(), kind, chars, keywords: keywordsOf(rest) };
}

/** Weapon header row: Range plus at least A and D, maybe a leading name column. */
function weaponHeader(line: string): { keys: string[]; kind?: Kind } | null {
  let kind: Kind | undefined;
  const raw = line
    .replace(/\b(ranged|shooting)\s+weapons?\b/i, () => ((kind = "ranged"), ""))
    .replace(/\b(melee|close combat)\s+weapons?\b/i, () => ((kind = "melee"), ""))
    .replace(/^\s*(weapons?|name|wargear)\b/i, "");
  const keys = cells(raw).map((c) => WEAPON_KEYS[norm(c)] ?? "");
  if (keys.some((k) => !k) || !keys.includes("RANGE") || !keys.includes("A") || !keys.includes("D"))
    return null;
  if (keys.includes("WS")) kind = "melee";
  return { keys, ...(kind ? { kind } : {}) };
}

/** "Pulse rifle 24" A2 BS3+ S4 AP-1 D1 [Assault]", with colons or bars or not. */
function labelledWeapon(line: string, hint: Kind | undefined): Omit<WeaponProfile, "id"> | null {
  const label = (k: string) =>
    new RegExp(
      `(?:^|[\\s|,;(])${k}\\s*[:=]?\\s*(\\d*D\\d+(?:\\+\\d+)?|-?\\d+\\+?|N/A|user)(?=$|[\\s|,;)])`,
      "i",
    );
  // The last match: "A D6 … D1" has a D6 before the Damage.
  const get = (k: string) => [...line.matchAll(new RegExp(label(k), "gi"))].pop() ?? null;
  const a = get("A"),
    s = get("S"),
    ap = get("AP"),
    d = get("D"),
    bs = get("BS"),
    ws = get("WS");
  if (!a || !s || !ap || !d) return null;
  const range =
    /(?:^|[\s|,;(:])(?:range\s*[:=]?\s*)?(\d+(?:\.\d+)?"|melee)(?=$|[\s|,;)])/i.exec(line) ??
    /(?:^|[\s|,;(])range\s*[:=]?\s*(\d+|melee)(?=$|[\s|,;)])/i.exec(line);
  const marks = [a, s, ap, d, bs, ws, range].filter((m): m is RegExpExecArray => !!m);
  const first = Math.min(...marks.map((m) => m.index));
  const last = Math.max(...marks.map((m) => m.index + m[0].length));
  const name = line
    .slice(0, first)
    .replace(/[(:|-]+\s*$/, "")
    .trim();
  if (!name) return null;
  const skillKey = ws ? "WS" : bs ? "BS" : undefined;
  const rangeText = range
    ? /^\d+$/.test(range[1]!)
      ? `${range[1]}"`
      : range[1]!
    : hint === "melee"
      ? "Melee"
      : "-";
  return weapon(
    name,
    [rangeText, a[1]!, (ws ?? bs)?.[1] ?? "-", s[1]!, ap[1]!, d[1]!],
    line.slice(last).replace(/^[\s)|,;]+/, ""),
    hint,
    skillKey,
  );
}

/** A weapon row in table form: name, then Range A BS S AP D, then keywords. */
function positionalWeapon(
  line: string,
  hint: Kind | undefined,
  pendingName: string | undefined,
  header?: { keys: string[] },
): Omit<WeaponProfile, "id"> | null {
  const raw = line
    .replace(/\s*\|\s*/g, " | ")
    .split(/\s+/)
    .filter((x) => x !== "|");
  const t = raw.map((x) => x.replace(/^[(]|[,;:)]$/g, ""));
  for (let i = 0; i < t.length; i++) {
    const six = statsAt(t, i, !!header);
    if (!six) continue;
    const name =
      raw
        .slice(0, i)
        .join(" ")
        .replace(/[(:|-]+$/, "")
        .trim() || pendingName;
    if (!name) return null;
    const skillKey = header?.keys.includes("WS") ? "WS" : header?.keys.includes("BS") ? "BS" : undefined;
    return weapon(name, six, raw.slice(i + 6).join(" "), hint, skillKey);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type Section = "chars" | "ranged" | "melee" | "weapons" | "abilities" | "keywords" | "other";

/** A heading line, with whatever follows its colon. */
function heading(line: string): { section: Section; rest: string } | null {
  const m =
    /^(ranged weapons?|shooting weapons?|melee weapons?|close combat weapons?|weapons?|wargear|(?:core |faction |unit |other |wargear |special )?abilities|special rules|rules|faction keywords|keywords|unit composition|composition|points|cost)\s*:?\s*(.*)$/i.exec(
      line,
    );
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  const rest = m[2]!.trim();
  // "Weapons Range A BS..." is a header row, read as such by the caller.
  if (/^(range|rng)\b/i.test(rest)) return null;
  const section: Section = /ranged|shooting/.test(h)
    ? "ranged"
    : /melee|close/.test(h)
      ? "melee"
      : /^weapons?$|wargear$/.test(h)
        ? "weapons"
        : /abilit|rules/.test(h)
          ? "abilities"
          : /keyword/.test(h)
            ? "keywords"
            : "other";
  return { section, rest };
}

const INVULN =
  /(?:invulnerable save|invuln(?:erable)?|\binv(?:\s*sv)?)\s*[:-]?\s*(\d)\+|(\d)\+\s*invulnerable/i;
const POINTS = /^(?:points|pts|cost)\s*[:-]?\s*(\d+)\s*(?:pts|points)?$|^(\d+)\s*(?:pts|points)$/i;
/** A line that is all ability names: "Deep Strike, Leader", "CORE: Deep Strike". */
const NAME_LIST_PREFIX = /^(core|faction|unit|wargear|other)\s*:\s*/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const sentence = (s: string) => /[.!?]$/.test(s) || words(s) > 8;

/** Read one model's TTS description. */
export function readDescription(raw: string, ignore: string[] = []): TtsProfile {
  const out: TtsProfile = { chars: {}, weapons: [], abilities: [], keywords: [], unparsed: [] };
  const skip = new Set(ignore.map((s) => s.toLowerCase()).filter(Boolean));
  const lines = descriptionLines(raw);
  let section: Section | undefined;
  let unitKeys: string[] | null = null;
  let wHeader: { keys: string[]; kind?: Kind } | null = null;
  let pendingName: string | undefined;
  let last: Ability | undefined;

  const addAbility = (name: string, text = "") => {
    const n = name.replace(/[:\-–]+$/, "").trim();
    if (!n) return;
    const found = out.abilities.find((a) => a.name.toLowerCase() === n.toLowerCase());
    if (found) {
      if (text && !found.text) found.text = text;
      last = found;
      return;
    }
    last = { name: n, text };
    out.abilities.push(last);
  };
  const addKeywords = (s: string) => {
    for (const k of keywordsOf(s)) if (!out.keywords.includes(k)) out.keywords.push(k);
  };
  const hint = (): Kind | undefined =>
    section === "melee" ? "melee" : section === "ranged" ? "ranged" : wHeader?.kind;
  const tryWeapon = (line: string): boolean => {
    const w =
      positionalWeapon(line, hint(), pendingName, wHeader ?? undefined) ?? labelledWeapon(line, hint());
    if (!w) return false;
    out.weapons.push(w);
    pendingName = undefined;
    return true;
  };
  /** An ability line: "Name: text", "Name - text", a list of names, a name, or more text for the last one. */
  const abilityLine = (line: string): boolean => {
    const listed = line.replace(NAME_LIST_PREFIX, "");
    const colon = /^([^:.]{2,60}?)\s*(?::|\s-\s)\s*(.+)$/.exec(listed);
    if (colon && words(colon[1]!) <= 8 && !NAME_LIST_PREFIX.test(line)) {
      addAbility(colon[1]!, colon[2]!);
      return true;
    }
    const parts = listed.split(/\s*,\s*/);
    if (parts.length > 1 && parts.every((p) => p && words(p) <= 5 && !/[.!?]$/.test(p))) {
      parts.forEach((p) => addAbility(p));
      return true;
    }
    if (!sentence(listed) && words(listed) <= 6) {
      addAbility(listed);
      return true;
    }
    if (last && sentence(listed)) {
      last.text = last.text ? `${last.text} ${listed}` : listed;
      return true;
    }
    return false;
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (skip.has(lower) || /^\d+\s*\/\s*\d+$/.test(line) || /^[-=_*~.]{3,}$/.test(line)) continue;

    // Characteristics: a header row, then its values.
    if (unitKeys) {
      const vals = cells(line);
      if (vals.length >= unitKeys.length && vals.slice(0, unitKeys.length).every((v) => VALUE.test(v))) {
        unitKeys.forEach((k, i) => {
          const v = vals[i]!;
          if (v !== "-" && v !== "*") out.chars[k] = v;
        });
        unitKeys = null;
        section = "chars";
        continue;
      }
      unitKeys = null;
    }
    const uh = unitHeader(line);
    if (uh) {
      unitKeys = uh;
      continue;
    }
    const inline = inlineUnitChars(line);
    if (inline) {
      Object.assign(out.chars, inline);
      const inv = INVULN.exec(line);
      if (inv) out.chars.INV = `${inv[1] ?? inv[2]}+`;
      continue;
    }
    const inv = INVULN.exec(line);
    if (inv && words(line) <= 5) {
      out.chars.INV = `${inv[1] ?? inv[2]}+`;
      continue;
    }
    const pts = POINTS.exec(line);
    if (pts) {
      out.points = Number(pts[1] ?? pts[2]);
      continue;
    }

    const wh = weaponHeader(line);
    if (wh) {
      wHeader = wh;
      if (wh.kind) section = wh.kind;
      else if (section !== "ranged" && section !== "melee") section = "weapons";
      continue;
    }
    const h = heading(line);
    if (h) {
      section = h.section;
      wHeader = null;
      pendingName = undefined;
      last = undefined;
      if (h.rest) {
        if (section === "keywords") addKeywords(h.rest);
        else if (section === "abilities") {
          if (!abilityLine(h.rest)) out.unparsed.push(line);
        } else if (section === "other") {
          // Composition and the like: not part of the profile.
        } else if (!tryWeapon(h.rest)) out.unparsed.push(line);
      }
      continue;
    }

    if (section === "keywords") {
      addKeywords(line);
      continue;
    }
    if (section === "other") continue;
    // A weapon row, in any section: its numbers give it away.
    if (tryWeapon(line)) continue;
    // Keywords alone on the line after a weapon.
    if (/^\[.*\]$/.test(line) && out.weapons.length) {
      out.weapons[out.weapons.length - 1]!.keywords.push(...keywordsOf(line));
      continue;
    }
    if (section === "ranged" || section === "melee" || section === "weapons") {
      // A weapon's name on its own line, its numbers on the next.
      if (!sentence(line) && words(line) <= 8) {
        pendingName = line.replace(/[:-]+$/, "").trim();
        continue;
      }
      out.unparsed.push(line);
      continue;
    }
    if (section === "abilities" || section === "chars" || section === undefined) {
      // Outside a section only "Name: text" counts; a bare line could be anything.
      if (section === "abilities" ? abilityLine(line) : /^[^:.]{2,60}:\s*\S/.test(line) && abilityLine(line))
        continue;
    }
    out.unparsed.push(line);
  }
  return out;
}
