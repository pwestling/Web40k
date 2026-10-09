#!/usr/bin/env node
/**
 * Real-input check for Old World army import (#66): builds rosters from the
 * public community catalogues (New Recruit's BattleScribe data, saved as
 * JSON) the way the list builder would save them, so the importer and the
 * special rules it automates can be tried on real armies. Nothing it fetches
 * or writes is committed: the catalogues are cloned into a cache folder and
 * the rosters written next to them.
 *
 *   node scripts/bsdata-tow.mjs [outDir]       (default: .bsdata/tow-rosters, git-ignored)
 *
 * Then `BSDATA_TOW=.bsdata/tow-rosters pnpm vitest run src/systems/tow/bsdata.test.ts`
 * imports each roster and prints which special rules the app plays.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "https://github.com/vflam/Warhammer-The-Old-World.git";
const out = process.argv[2] ?? join(".bsdata", "tow-rosters");
const src = join(".bsdata", "tow");

/** The armies tried: each main army book's catalogue. */
const ARMIES = [
  "Bretonnians",
  "The Empire of Man",
  "Dwarfen Mountain Holds",
  "High Elf Realms",
  "Wood Elf Realms",
  "Orc and Goblin Tribes",
  "Warriors of Chaos",
  "Beastmen Brayherds",
  "Tomb Kings of Khemri",
  "Vampire Counts",
  "Skaven",
  "Lizardmen",
  "Ogre Kingdoms",
  "Dark Elves",
  "Daemons of Chaos",
  "Chaos Dwarfs",
  "Grand Cathay",
];
/** How many units of each list category a roster takes. */
const PICKS = [
  ["Characters", 3],
  ["Core", 3],
  ["Special", 3],
  ["Rare", 2],
];

if (!existsSync(src)) {
  mkdirSync(".bsdata", { recursive: true });
  execFileSync("git", ["clone", "-q", "--depth", "1", REPO, src], { stdio: "inherit" });
}
mkdirSync(out, { recursive: true });

/** Every element with an id, across the game system and all catalogues. */
const byId = new Map();
function index(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(index);
  if (typeof node.id === "string" && !byId.has(node.id)) byId.set(node.id, node);
  for (const v of Object.values(node)) if (v && typeof v === "object") index(v);
}
const docs = {};
for (const f of readdirSync(src).filter((f) => f.endsWith(".json"))) {
  const doc = JSON.parse(readFileSync(join(src, f), "utf8"));
  docs[f.replace(/\.json$/, "")] = doc.catalogue ?? doc.gameSystem;
  index(doc);
}

const list = (node, k) => (Array.isArray(node?.[k]) ? node[k] : []);
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Ids picked so far in this roster: for "hidden unless selected" modifiers. */
let chosen = new Set();

function condition(c) {
  const v = Number(c.value);
  const has = chosen.has(c.childId);
  if (c.type === "notInstanceOf") return !has;
  if (c.type === "instanceOf") return has;
  if (c.field !== "selections") return false;
  if (c.type === "lessThan") return v <= 1 ? !has : true;
  if (c.type === "atMost" || (c.type === "equalTo" && v === 0)) return v === 0 ? !has : true;
  if (c.type === "atLeast" || c.type === "greaterThan" || c.type === "equalTo") return v >= 1 ? has : !has;
  return false;
}
function group(g) {
  const cs = [...list(g, "conditions").map(condition), ...list(g, "conditionGroups").map(group)];
  return g.type === "or" ? cs.some(Boolean) : cs.every(Boolean);
}
function hidden(node) {
  let h = node?.hidden === true;
  for (const m of list(node, "modifiers")) {
    if (m.field !== "hidden" || m.type !== "set") continue;
    const cs = [...list(m, "conditions").map(condition), ...list(m, "conditionGroups").map(group)];
    if (!cs.length || cs.every(Boolean)) h = m.value === true || m.value === "true";
  }
  return h;
}

const charText = (c) => c.$text ?? c["#text"] ?? "";
const profileXml = (p) =>
  `<profile name="${esc(p.name)}" typeName="${esc(p.typeName)}"><characteristics>` +
  list(p, "characteristics")
    .map((c) => `<characteristic name="${esc(c.name)}">${esc(charText(c))}</characteristic>`)
    .join("") +
  `</characteristics></profile>`;
const ruleXml = (r) => `<rule name="${esc(r.name)}"><description>${esc(r.description)}</description></rule>`;

/** A name as the list builder shows it: "Armour Bane" with its "(1)" appended by a modifier. */
function named(node, name = node.name) {
  let n = name;
  for (const m of list(node, "modifiers")) {
    if (m.field !== "name") continue;
    const cs = [...list(m, "conditions").map(condition), ...list(m, "conditionGroups").map(group)];
    if (cs.length && !cs.every(Boolean)) continue;
    if (m.type === "set") n = String(m.value);
    else if (m.type === "append") n = `${n} ${m.value}`;
  }
  return n;
}

/** Profiles and rules of an entry, following info links and info groups. */
function info(node, acc = { profiles: [], rules: [] }) {
  for (const p of list(node, "profiles")) if (!hidden(p)) acc.profiles.push({ ...p, name: named(p) });
  for (const r of list(node, "rules")) if (!hidden(r)) acc.rules.push({ ...r, name: named(r) });
  for (const l of list(node, "infoLinks")) {
    if (hidden(l)) continue;
    const t = byId.get(l.targetId);
    if (!t || hidden(t)) continue;
    if (l.type === "profile") acc.profiles.push({ ...t, name: named(l, named(t, l.name || t.name)) });
    else if (l.type === "rule") acc.rules.push({ ...t, name: named(l, named(t)) });
    else if (l.type === "infoGroup") info(t, acc);
  }
  for (const g of list(node, "infoGroups")) if (!hidden(g)) info(g, acc);
  return acc;
}

const minOf = (node) =>
  Number(
    list(node, "constraints").find(
      (c) => c.type === "min" && c.field === "selections" && c.scope === "parent",
    )?.value ?? 0,
  );
const ptsOf = (node) =>
  list(node, "costs")
    .filter((c) => c.name === "pts")
    .reduce((n, c) => n + Number(c.value), 0);

/** An entry link resolved: the target, with the link's own constraints and categories. */
function resolve(link) {
  const t = byId.get(link.targetId);
  if (!t) return null;
  return { node: t, min: minOf(link) || minOf(t), link, group: link.type === "selectionEntryGroup" };
}

/** Child entries taken by default: required ones, and each group's default (or first) pick. */
function defaults(node) {
  const res = [];
  const entries = [
    ...list(node, "selectionEntries").map((n) => ({ node: n, min: minOf(n) })),
    ...list(node, "entryLinks").map(resolve).filter(Boolean),
    ...list(node, "selectionEntryGroups").map((n) => ({ node: n, min: minOf(n), group: true })),
  ];
  for (const e of entries) {
    if (hidden(e.node) || (e.link && hidden(e.link))) continue;
    if (e.group) {
      const all = [
        ...list(e.node, "selectionEntries"),
        ...list(e.node, "entryLinks")
          .map((l) => resolve(l)?.node)
          .filter(Boolean),
      ].filter((n) => !hidden(n));
      const def = e.node.defaultSelectionEntryId;
      const pick = all.find((n) => n.id === def) ?? (e.min > 0 ? all[0] : undefined);
      const inner = defaults({ ...e.node, selectionEntryGroups: [] }).filter((d) => d.node !== pick);
      res.push(...inner.filter((d) => d.min > 0));
      if (pick) res.push({ node: pick, n: Math.max(1, e.min) });
      for (const g of list(e.node, "selectionEntryGroups"))
        res.push(...defaults({ selectionEntryGroups: [g] }));
    } else if (e.min > 0) res.push({ node: e.node, n: e.min, min: e.min });
  }
  return res.map((d) => ({ ...d, n: d.n ?? d.min }));
}

/** A selection as the list builder saves it. */
function selectionXml(node, number, cats = []) {
  chosen.add(node.id);
  const children = defaults(node);
  for (const d of children) chosen.add(d.node.id);
  const { profiles, rules } = info(node);
  const catXml = [...cats, ...list(node, "categoryLinks")]
    .filter((c) => !hidden(c))
    .map((c) => `<category name="${esc(c.name)}" primary="${c.primary ? "true" : "false"}"/>`)
    .join("");
  const childXml = children
    .map((d) => selectionXml(d.node, d.n * (node.type === "model" ? number : 1)))
    .join("");
  const pts = ptsOf(node) * number;
  return (
    `<selection name="${esc(node.name)}" type="${node.type || "upgrade"}" number="${number}">` +
    (pts ? `<costs><cost name="pts" value="${pts}"/></costs>` : "") +
    (rules.length ? `<rules>${rules.map(ruleXml).join("")}</rules>` : "") +
    (profiles.length ? `<profiles>${profiles.map(profileXml).join("")}</profiles>` : "") +
    (catXml ? `<categories>${catXml}</categories>` : "") +
    (childXml ? `<selections>${childXml}</selections>` : "") +
    `</selection>`
  );
}

for (const army of ARMIES) {
  const doc = docs[army];
  if (!doc) {
    console.warn(`missing ${army}`);
    continue;
  }
  chosen = new Set();
  const roots = [
    ...list(doc, "selectionEntries").map((n) => ({ node: n, cats: list(n, "categoryLinks") })),
    ...list(doc, "entryLinks")
      .filter((l) => !hidden(l))
      .map((l) => ({ node: byId.get(l.targetId), cats: list(l, "categoryLinks") }))
      .filter((r) => r.node && ["unit", "model"].includes(r.node.type) && !hidden(r.node)),
  ];
  const catOf = (r, name) => r.cats.some((c) => c.name === name);
  const picks = [];
  for (const [cat, n] of PICKS)
    picks.push(...roots.filter((r) => catOf(r, cat) && !catOf(r, "Named Characters")).slice(0, n));
  const xml = picks.map((r) => selectionXml(r.node, 1, r.cats)).join("");
  const pts = [...xml.matchAll(/<cost name="pts" value="([\d.]+)"/g)].reduce((n, m) => n + Number(m[1]), 0);
  const ros =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<roster name="${esc(doc.name)}" gameSystemName="Warhammer: The Old World" xmlns="http://www.battlescribe.net/schema/rosterSchema">` +
    `<costs><cost name="pts" value="${pts}"/></costs>` +
    `<forces><force name="Open War" catalogueName="${esc(doc.name)}"><selections>${xml}</selections></force></forces></roster>\n`;
  const file = join(out, `${army.replace(/[^A-Za-z0-9]+/g, "-")}.ros`);
  writeFileSync(file, ros);
  console.log(`${file}: ${picks.map((r) => r.node.name).join(", ")}`);
}
