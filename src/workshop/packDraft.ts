import type { Ability, AbilityAuto, ArmyStratagem, Unit } from "../core/types";
import type { GameSystem } from "../core/content/schema";
import { describesWeaponKeyword, isAutomated, isWeaponRule } from "../core/content/player";
import { applyPack, packName, readFactionPack } from "../packages/faction";
import type { FactionPack, PackRule, PackStratagem } from "../packages/factionFormat";
import { readLiteral } from "../packages/manifest";
import { teach, teachingOf } from "../systems/wh40k/teach";
import { ARMY_RULE, ENHANCEMENTS, type ImportedRoster } from "../systems/wh40k/roster";

/**
 * The pack workshop (#79): a faction pack draft built against one of the
 * player's own armies. The names in the army and how each plays now, a rule
 * built for a name written into the draft's `faction` literal as data, the
 * army's taught rules pulled in at once, and the pack's names checked against
 * the army. Nothing here runs the draft.
 */

/** Where a name sits in an army, and so in a pack. */
export type NameKind = "ability" | "enhancement" | "army" | "detachment" | "stratagem";

export interface RosterName {
  /** As the army spells it (the first time it comes up). */
  name: string;
  kind: NameKind;
  /** The army's own words for it (the player's data, quoted in the builder). */
  text: string;
  /** How it plays now: by hand, taught by the player, read by the app, or by a faction pack. */
  status: "manual" | "taught" | "automated" | "pack";
  auto?: AbilityAuto;
  /** The army's stratagem, for a stratagem. */
  stratagem?: ArmyStratagem;
  /** The units that carry it (abilities and enhancements). */
  units: string[];
}

const statusOf = (system: GameSystem, a: Ability): RosterName["status"] =>
  a.auto?.pack ? "pack" : a.auto?.taught ? "taught" : isAutomated(system, a) ? "automated" : "manual";

/**
 * Every rule name in an army a pack could key: its units' abilities and
 * enhancements (not weapon keywords or profile groups), its army and
 * detachment rules, and its stratagems; each once.
 */
export function rosterNames(
  roster: ImportedRoster,
  system: GameSystem,
  profiles: string[] = [],
): RosterName[] {
  const out: RosterName[] = [];
  const byKey = new Map<string, RosterName>();
  const add = (n: RosterName) => {
    const key = `${n.kind === "stratagem" ? "s" : "r"}/${packName(n.name)}`;
    const had = byKey.get(key);
    if (had) {
      for (const u of n.units) if (!had.units.includes(u)) had.units.push(u);
      return;
    }
    byKey.set(key, n);
    out.push(n);
  };
  const army = roster.army;
  for (const r of army?.rules ?? []) {
    if (isWeaponRule(system, r)) continue;
    const kind: NameKind = r.group === ARMY_RULE || !army?.detachment ? "army" : "detachment";
    add({ name: r.name, kind, text: r.text, status: statusOf(system, r), ...auto(r), units: [] });
  }
  for (const u of roster.units) {
    const asUnit = { sheet: u.sheet } as Unit;
    for (const a of u.sheet.abilities) {
      if (profiles.includes(a.group ?? "")) continue;
      if (a.group !== ENHANCEMENTS && describesWeaponKeyword(system, asUnit, a)) continue;
      // An army rule a unit also lists is the army's.
      if (army?.rules.some((r) => packName(r.name) === packName(a.name))) continue;
      add({
        name: a.name,
        kind: a.group === ENHANCEMENTS ? "enhancement" : "ability",
        text: a.text,
        status: statusOf(system, a),
        ...auto(a),
        units: [u.name],
      });
    }
  }
  for (const s of army?.stratagems ?? [])
    add({
      name: s.name,
      kind: "stratagem",
      text: s.text,
      status: s.auto?.pack || s.pack ? "pack" : s.auto?.taught ? "taught" : s.auto ? "automated" : "manual",
      ...auto(s),
      stratagem: s,
      units: [],
    });
  return out;
}

const auto = (a: { auto?: AbilityAuto }) => (a.auto ? { auto: a.auto } : {});

/**
 * A rule for a pack from what the builder made: its `teach` when the rule
 * reads back the same through the builder (it came from Teach it), else its
 * automated parts. Null makes a rule with no effect: played by hand.
 */
export function ruleFrom(
  name: string,
  made: AbilityAuto | null,
  system: GameSystem,
  summary?: string,
): PackRule {
  const out: PackRule = { name, ...(summary?.trim() ? { summary: summary.trim() } : {}) };
  if (!made) return out;
  const teaching = teachingOf(made);
  const bare = (a: AbilityAuto | null) => {
    if (!a) return null;
    const { effects: _e, taught: _t, pack: _p, ...rest } = a;
    return rest;
  };
  // The same parts, aura, trigger and flags back through the builder: keep it in the builder's terms.
  if (JSON.stringify(bare(teach(teaching, system))) === JSON.stringify(bare(made)))
    return { ...out, teach: teaching };
  return { ...out, auto: bare(made)! };
}

/** A stratagem for a pack: its cost and timing as the army has them (or the builder set), and what it does. */
export function stratagemFrom(
  s: Pick<
    ArmyStratagem,
    "name" | "cp" | "side" | "phases" | "once" | "targetKeywords" | "notYet" | "targetsUnit"
  >,
  made: AbilityAuto | null,
  system: GameSystem,
  summary?: string,
): PackStratagem {
  const { name: _n, ...rule } = ruleFrom(s.name, made, system, summary);
  const unit = s.targetsUnit !== false || !!made;
  return {
    name: s.name,
    cp: s.cp,
    side: s.side,
    ...(s.phases?.length ? { phases: s.phases } : {}),
    ...(s.once && s.once !== "phase" ? { once: s.once } : {}),
    ...(unit
      ? s.targetKeywords || s.notYet
        ? {
            target: {
              ...(s.targetKeywords ? { keywords: s.targetKeywords } : {}),
              ...(s.notYet ? { notYet: s.notYet } : {}),
            },
          }
        : {}
      : { target: false as const }),
    ...rule,
  };
}

type Entry = PackRule | PackStratagem;
type ListKey = "rules" | "abilities" | "stratagems";
type DetachmentKey = "rules" | "enhancements" | "stratagems";

/** Where a new entry of this kind goes: the detachment's lists when the army has one. */
function slotOf(
  kind: NameKind,
  detachment?: string,
): { list: ListKey } | { detachment: string; list: DetachmentKey } {
  if (kind === "ability") return { list: "abilities" };
  if (kind === "army") return { list: "rules" };
  if (!detachment)
    return { list: kind === "enhancement" ? "abilities" : kind === "stratagem" ? "stratagems" : "rules" };
  return {
    detachment,
    list: kind === "enhancement" ? "enhancements" : kind === "stratagem" ? "stratagems" : "rules",
  };
}

/**
 * Put an entry in a pack: in place of one with the same name (wherever the
 * author put it; its summary stays if the new one has none), else where its
 * kind goes. The pack is copied, not changed.
 */
export function putEntry(pack: FactionPack, kind: NameKind, entry: Entry, detachment?: string): FactionPack {
  const next = JSON.parse(JSON.stringify(pack)) as FactionPack;
  const key = packName(entry.name);
  const lists: (Entry[] | undefined)[] =
    kind === "stratagem"
      ? [...(next.detachments ?? []).map((d) => d.stratagems), next.stratagems]
      : [next.abilities, next.rules, ...(next.detachments ?? []).flatMap((d) => [d.rules, d.enhancements])];
  for (const list of lists) {
    const i = list?.findIndex((e) => packName(e.name) === key) ?? -1;
    if (i < 0) continue;
    const old = list![i]!;
    list![i] = { ...entry, ...(!entry.summary && old.summary ? { summary: old.summary } : {}) };
    return next;
  }
  const slot = slotOf(kind, detachment);
  if ("detachment" in slot) {
    next.detachments ??= [];
    let d = next.detachments.find((x) => packName(x.name) === packName(slot.detachment));
    if (!d) next.detachments.push((d = { name: slot.detachment }));
    ((d[slot.list] ??= []) as Entry[]).push(entry);
  } else ((next[slot.list] ??= []) as Entry[]).push(entry);
  return next;
}

/** The rules the player taught on this army (#53), as pack entries, by kind. */
function taughtEntries(roster: ImportedRoster, system: GameSystem): { kind: NameKind; entry: Entry }[] {
  return rosterNames(roster, system)
    .filter((n) => n.status === "taught" && n.auto)
    .map((n) => ({
      kind: n.kind,
      entry:
        n.kind === "stratagem" && n.stratagem
          ? stratagemFrom({ ...n.stratagem, targetsUnit: true }, n.auto!, system)
          : ruleFrom(n.name, n.auto!, system),
    }));
}

/** Every taught rule of an army put in a pack in one go; how many there were. */
export function pullTaught(
  pack: FactionPack,
  roster: ImportedRoster,
  system: GameSystem,
): { pack: FactionPack; count: number } {
  const all = taughtEntries(roster, system);
  return {
    pack: all.reduce((p, { kind, entry }) => putEntry(p, kind, entry, roster.army?.detachment), pack),
    count: all.length,
  };
}

/* ── Writing the pack back into the draft ── */

const IDENT = /^[A-Za-z_$][\w$]*$/;
const WIDTH = 100;

/** A value as a JS literal, laid out as a person would: short things on one line. */
export function toLiteral(v: unknown, indent = ""): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  const inner = indent + "  ";
  const isArray = Array.isArray(v);
  const items = isArray
    ? (v as unknown[]).map((x) => toLiteral(x, inner))
    : Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${toLiteral(x, inner)}`);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (!items.length) return `${open}${close}`;
  const flat = isArray ? `[${items.join(", ")}]` : `{ ${items.join(", ")} }`;
  if (!flat.includes("\n") && indent.length + flat.length <= WIDTH) return flat;
  return `${open}\n${items.map((i) => `${inner}${i},`).join("\n")}\n${indent}${close}`;
}

/**
 * The draft with its `faction` literal replaced by this pack, written out
 * afresh (comments inside the literal go; the rest of the file stays as it
 * is). A draft with no `faction` gets one after its manifest.
 */
export function writeFaction(source: string, pack: FactionPack): string {
  const text = toLiteral(pack);
  const at = readLiteral(source, "faction");
  if (at && "start" in at) return source.slice(0, at.start) + text + source.slice(at.end);
  const block = `\nexport const faction = ${text};\n`;
  const manifest = readLiteral(source, "manifest");
  if (manifest && "end" in manifest) {
    const end = source.indexOf(";", manifest.end) === manifest.end ? manifest.end + 1 : manifest.end;
    return source.slice(0, end) + "\n" + block + source.slice(end);
  }
  return source + block;
}

/** The pack in a draft, or why it can't be read. */
export function draftPack(source: string): FactionPack | string {
  const read = readFactionPack(source);
  return "error" in read ? read.error : read.pack;
}

/* ── Checking the pack's names against the army ── */

export interface NameProblem {
  name: string;
  /** Where in the pack ("abilities", "detachments[0].stratagems"). */
  where: string;
  line: number | null;
  /** Why it plays nothing in this army. */
  why: "no-unit" | "not-army-rule" | "detachment" | "faction" | "twice";
}

export interface NameCheck {
  problems: NameProblem[];
  /** Names the pack adds to this army (rules and stratagems the list doesn't carry). */
  added: string[];
  /** Names in the army the pack matches. */
  matched: number;
  /** Names in the army still played by hand with the pack on. */
  uncovered: RosterName[];
}

/** The name the check applies a draft under, to tell its rules from other packs'. */
const DRAFT = "\u0000draft";

/** An army's names with the draft pack on it: the ones it plays carry its rule (packRule). */
export function namesWithPack(
  roster: ImportedRoster,
  pack: FactionPack,
  system: GameSystem,
  profiles: string[] = [],
): RosterName[] {
  const ref = { id: "draft", name: DRAFT, version: "0", hash: "draft", bytes: 0 };
  return rosterNames(applyPack(roster, pack, ref, system).roster, system, profiles);
}

/** The rule the draft pack gives a name (from namesWithPack), or null. */
export const packRule = (n: RosterName): AbilityAuto | null => (n.auto?.pack === DRAFT ? n.auto : null);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The line a name is written on in the draft's `faction` literal (the n-th time it is, for repeats). */
function lineOfName(source: string, name: string, nth = 0): number | null {
  const from = Math.max(0, source.search(/export\s+const\s+faction\b/));
  const re = new RegExp(`\\bname\\s*:\\s*(["'\`])${escape(name)}\\1`, "g");
  re.lastIndex = from;
  let m: RegExpExecArray | null = null;
  for (let i = 0; i <= nth; i++) {
    m = re.exec(source);
    if (!m) return null;
  }
  return source.slice(0, m!.index).split("\n").length;
}

/**
 * Every name in the pack checked against an army (#79): a unit ability or
 * enhancement no unit has, a detachment that isn't the army's, an army rule
 * for another faction, and a name written twice, each with its line. Names
 * the pack adds (a detachment's rules and stratagems, the faction's rules)
 * aren't problems. The names still played by hand with the pack on are
 * listed as not covered yet. Nothing here stops a save.
 */
export function checkNames(
  source: string,
  pack: FactionPack,
  roster: ImportedRoster,
  system: GameSystem,
  profiles: string[] = [],
): NameCheck {
  const names = rosterNames(roster, system, profiles);
  const has = (key: string, kinds: NameKind[]) =>
    names.some((n) => kinds.includes(n.kind) && packName(n.name) === key);
  const problems: NameProblem[] = [];
  const added: string[] = [];
  const seen = new Map<string, number>();
  const counted = new Set<string>();
  const army = roster.army;
  const faction = !pack.faction || !army?.faction || packName(pack.faction) === packName(army.faction);
  const problem = (name: string, where: string, why: NameProblem["why"]) => {
    const n = seen.get(name) ?? 0;
    problems.push({ name, where, line: lineOfName(source, name, Math.max(0, n - 1)), why });
  };
  const look = (
    entries: Entry[] | undefined,
    where: string,
    kinds: NameKind[],
    adds: boolean,
    scope: string,
  ) => {
    for (const e of entries ?? []) {
      const key = packName(e.name);
      seen.set(e.name, (seen.get(e.name) ?? 0) + 1);
      const twice = `${scope}/${key}`;
      if (counted.has(twice)) {
        problem(e.name, where, "twice");
        continue;
      }
      counted.add(twice);
      if (has(key, kinds)) continue;
      if (adds) added.push(e.name);
      else
        problem(
          e.name,
          where,
          kinds.includes("army") && !faction
            ? "faction"
            : kinds.includes("army")
              ? "not-army-rule"
              : "no-unit",
        );
    }
  };
  look(pack.rules, "rules", ["army", "detachment", "ability"], faction, "rule");
  look(pack.abilities, "abilities", ["ability", "enhancement"], false, "rule");
  look(pack.stratagems, "stratagems", ["stratagem"], true, "strat");
  (pack.detachments ?? []).forEach((d, i) => {
    const mine = !!army?.detachment && packName(d.name) === packName(army.detachment);
    if (!mine) {
      seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
      problem(d.name, `detachments[${i}]`, "detachment");
      return;
    }
    look(d.rules, `detachments[${i}].rules`, ["detachment", "army", "ability"], true, "rule");
    look(d.enhancements, `detachments[${i}].enhancements`, ["enhancement", "ability"], false, "rule");
    look(d.stratagems, `detachments[${i}].stratagems`, ["stratagem"], true, "strat");
  });
  // With the pack on: the army's own names it plays, and those still played by hand.
  const after = namesWithPack(roster, pack, system, profiles);
  const own = new Set(names.map((n) => `${n.kind === "stratagem"}/${packName(n.name)}`));
  const mine = after.filter((n) => own.has(`${n.kind === "stratagem"}/${packName(n.name)}`));
  return {
    problems,
    added,
    matched: mine.filter((n) => packRule(n)).length,
    uncovered: mine.filter((n) => n.status === "manual"),
  };
}
