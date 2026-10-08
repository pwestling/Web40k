#!/usr/bin/env node
/**
 * Real-input check for army import (#51): builds small rosters from the
 * public BSData catalogues the way BattleScribe would save them, so the
 * importer can be tried on real data. Nothing it fetches or writes is
 * committed: the catalogues are cloned into a cache folder and the rosters
 * written next to them.
 *
 *   node scripts/bsdata.mjs [outDir]       (default: .bsdata/, git-ignored)
 *
 * Then `BSDATA=.bsdata pnpm vitest run src/systems/wh40k/bsdata.test.ts`
 * imports each roster and prints what the app automates.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";

const REPO = "https://github.com/BSData/wh40k-10e.git";
const out = process.argv[2] ?? ".bsdata";
const src = join(out, "wh40k-10e");

/** The factions tried, with the detachment to take (first one when absent). */
const FACTIONS = [
  { file: "Imperium - Space Marines.cat", detachment: "Gladius Task Force" },
  { file: "Necrons.cat", detachment: "Awakened Dynasty" },
  { file: "Orks.cat", detachment: "War Horde" },
  { file: "Aeldari - Craftworlds.cat", detachment: "Battle Host" },
  { file: "Tyranids.cat", detachment: "Invasion Fleet" },
  { file: "Imperium - Astra Militarum.cat", detachment: "Combined Regiment" },
];

if (!existsSync(src)) {
  mkdirSync(out, { recursive: true });
  execFileSync("git", ["clone", "-q", "--depth", "1", REPO, src], { stdio: "inherit" });
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

/** Every element with an id, across the game system and all catalogues. */
const byId = new Map();
function index(node, tag) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => index(n, tag));
  if (node["@_id"] && !byId.has(node["@_id"])) byId.set(node["@_id"], { tag, node });
  for (const [k, v] of Object.entries(node)) if (!k.startsWith("@_") && k !== "#text") index(v, k);
}
const docs = {};
for (const f of readdirSync(src).filter((f) => /\.(cat|gst)$/.test(f))) {
  const doc = parser.parse(readFileSync(join(src, f), "utf8"));
  docs[f] = doc;
  index(doc, "");
}

const kids = (node, plural, singular) => node?.[plural]?.[0]?.[singular] ?? [];
const attr = (node, k) => node?.[`@_${k}`] ?? "";
const textOf = (v) => (typeof v === "string" ? v : (v?.["#text"] ?? ""));
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Ids picked so far (the detachment, enhancements): for "hidden unless selected" modifiers. */
let chosen = new Set();

function condition(c) {
  const v = Number(attr(c, "value"));
  const has = chosen.has(attr(c, "childId"));
  const field = attr(c, "field");
  const type = attr(c, "type");
  if (field === "forces") return type === "lessThan" ? true : false; // no Crusade force, no allied forces
  if (field !== "selections") return false;
  if (type === "lessThan") return v <= 1 ? !has : true;
  if (type === "atLeast" || type === "greaterThan" || type === "equalTo") return v >= 1 ? has : !has;
  if (type === "notInstanceOf") return true;
  return false;
}

function group(g) {
  const cs = [
    ...kids(g, "conditions", "condition").map(condition),
    ...kids(g, "conditionGroups", "conditionGroup").map(group),
  ];
  return attr(g, "type") === "or" ? cs.some(Boolean) : cs.every(Boolean);
}

function hidden(node) {
  if (attr(node, "hidden") === "true") return true;
  for (const m of kids(node, "modifiers", "modifier")) {
    if (attr(m, "field") !== "hidden" || attr(m, "type") !== "set") continue;
    const cs = [
      ...kids(m, "conditions", "condition").map(condition),
      ...kids(m, "conditionGroups", "conditionGroup").map(group),
    ];
    if (cs.length && cs.every(Boolean)) return attr(m, "value") === "true";
  }
  return false;
}

function profileXml(p) {
  const chars = kids(p, "characteristics", "characteristic")
    .map((c) => `<characteristic name="${esc(attr(c, "name"))}">${esc(textOf(c))}</characteristic>`)
    .join("");
  return `<profile name="${esc(attr(p, "name"))}" typeName="${esc(attr(p, "typeName"))}"><characteristics>${chars}</characteristics></profile>`;
}
const ruleXml = (r) =>
  `<rule name="${esc(attr(r, "name"))}"><description>${esc(textOf(r.description?.[0]))}</description></rule>`;

/** Profiles and rules of an entry, following info links and info groups. */
function info(node, acc = { profiles: [], rules: [] }) {
  for (const p of kids(node, "profiles", "profile")) if (!hidden(p)) acc.profiles.push(p);
  for (const r of kids(node, "rules", "rule")) if (!hidden(r)) acc.rules.push(r);
  for (const l of kids(node, "infoLinks", "infoLink")) {
    if (hidden(l)) continue;
    const t = byId.get(attr(l, "targetId"))?.node;
    if (!t || hidden(t)) continue;
    if (attr(l, "type") === "profile") acc.profiles.push(t);
    else if (attr(l, "type") === "rule") acc.rules.push(t);
    else if (attr(l, "type") === "infoGroup") info(t, acc);
  }
  for (const g of kids(node, "infoGroups", "infoGroup")) if (!hidden(g)) info(g, acc);
  return acc;
}

const minOf = (node) => {
  const c = kids(node, "constraints", "constraint").find(
    (c) => attr(c, "type") === "min" && attr(c, "field") === "selections" && attr(c, "scope") === "parent",
  );
  return c ? Number(attr(c, "value")) : 0;
};
const ptsOf = (node) =>
  kids(node, "costs", "cost")
    .filter((c) => attr(c, "name") === "pts")
    .reduce((n, c) => n + Number(attr(c, "value")), 0);

/** An entry link resolved: the target with the link's own constraints when it has them. */
function resolve(link) {
  const t = byId.get(attr(link, "targetId"));
  if (!t) return null;
  return { tag: t.tag, node: t.node, min: minOf(link) || minOf(t.node), link };
}

/** Child entries taken by default: required ones, and each group's default (or first) pick. */
function defaults(node) {
  const out = [];
  const entries = [
    ...kids(node, "selectionEntries", "selectionEntry").map((n) => ({
      tag: "selectionEntry",
      node: n,
      min: minOf(n),
    })),
    ...kids(node, "entryLinks", "entryLink").map(resolve).filter(Boolean),
    ...kids(node, "selectionEntryGroups", "selectionEntryGroup").map((n) => ({
      tag: "selectionEntryGroup",
      node: n,
      min: minOf(n),
    })),
  ];
  for (const e of entries) {
    if (hidden(e.node) || (e.link && hidden(e.link))) continue;
    if (/crusade|enhancement|warlord/i.test(attr(e.node, "name"))) continue;
    if (e.tag === "selectionEntryGroup") {
      const def = attr(e.node, "defaultSelectionEntryId");
      const inner = defaults({ ...e.node, selectionEntryGroups: undefined });
      const all = [
        ...kids(e.node, "selectionEntries", "selectionEntry"),
        ...kids(e.node, "entryLinks", "entryLink")
          .map((l) => resolve(l)?.node)
          .filter(Boolean),
      ].filter((n) => !hidden(n));
      const pick =
        all.find((n) => attr(n, "id") === def) ??
        kids(e.node, "entryLinks", "entryLink")
          .filter((l) => attr(l, "id") === def)
          .map((l) => resolve(l)?.node)[0] ??
        (e.min > 0 ? all[0] : undefined);
      if (inner.length) out.push(...inner);
      else if (pick) out.push({ node: pick, n: Math.max(1, e.min) });
      for (const g of kids(e.node, "selectionEntryGroups", "selectionEntryGroup"))
        out.push(...defaults({ selectionEntryGroups: [{ selectionEntryGroup: [g] }] }));
    } else if (e.min > 0) out.push({ node: e.node, n: e.min });
  }
  return out;
}

/** A selection as BattleScribe saves it, with `extra` picks (enhancements) under it. */
function selectionXml(node, number, extra = []) {
  const { profiles, rules } = info(node);
  const cats = kids(node, "categoryLinks", "categoryLink")
    .filter((c) => !hidden(c))
    .map((c) => `<category name="${esc(attr(c, "name"))}" primary="${attr(c, "primary") || "false"}"/>`)
    .join("");
  const children = [...defaults(node).map((d) => selectionXml(d.node, d.n * number)), ...extra].join("");
  const pts = ptsOf(node) * (attr(node, "type") === "model" ? number : 1);
  return (
    `<selection name="${esc(attr(node, "name"))}" type="${attr(node, "type") || "upgrade"}" number="${number}">` +
    (pts ? `<costs><cost name="pts" value="${pts}"/></costs>` : "") +
    (rules.length ? `<rules>${rules.map(ruleXml).join("")}</rules>` : "") +
    (profiles.length ? `<profiles>${profiles.map(profileXml).join("")}</profiles>` : "") +
    (cats ? `<categories>${cats}</categories>` : "") +
    (children ? `<selections>${children}</selections>` : "") +
    `</selection>`
  );
}

const catName = (c) =>
  kids(c, "categoryLinks", "categoryLink")
    .filter((l) => !hidden(l))
    .map((l) => attr(l, "name").toLowerCase());

for (const f of FACTIONS) {
  const doc = docs[f.file]?.catalogue?.[0];
  if (!doc) {
    console.warn(`missing ${f.file}`);
    continue;
  }
  chosen = new Set();
  // The roots: the catalogue's own entries and links, the libraries' units among them.
  const roots = [
    ...kids(doc, "selectionEntries", "selectionEntry"),
    ...kids(doc, "entryLinks", "entryLink")
      .map((l) => resolve(l)?.node)
      .filter(Boolean),
  ];
  const detachEntry = roots.find((n) => attr(n, "name") === "Detachment");
  const detachGroup =
    kids(detachEntry, "selectionEntryGroups", "selectionEntryGroup")[0] ??
    kids(detachEntry, "entryLinks", "entryLink")
      .map((l) => resolve(l))
      .find((r) => r?.tag === "selectionEntryGroup")?.node;
  const options = [
    ...kids(detachGroup, "selectionEntries", "selectionEntry"),
    ...kids(detachGroup, "entryLinks", "entryLink")
      .map((l) => resolve(l)?.node)
      .filter(Boolean),
  ];
  const detachment = options.find((n) => attr(n, "name") === f.detachment) ?? options[0];
  if (!detachment) {
    console.warn(`${f.file}: no detachment`);
    continue;
  }
  chosen.add(attr(detachment, "id"));
  const units = roots.filter(
    (n) =>
      ["unit", "model"].includes(attr(n, "type")) &&
      !hidden(n) &&
      !/legends/i.test(attr(n, "name")) &&
      ptsOf(n) > 0,
  );
  const hasCat = (n, re) => catName(n).some((c) => re.test(c));
  const enhancementsOf = (n) =>
    kids(n, "entryLinks", "entryLink")
      .map((l) => resolve(l))
      .find((r) => r && /enhancement/i.test(attr(r.node, "name")));
  const character = units.find(
    (n) => hasCat(n, /^character$/) && !hasCat(n, /epic hero/) && enhancementsOf(n),
  );
  const picks = [
    character,
    ...units.filter((n) => hasCat(n, /^battleline$/)).slice(0, 2),
    units.find((n) => hasCat(n, /^(vehicle|monster)$/) && !hasCat(n, /titanic|epic hero/)),
    units.find((n) => hasCat(n, /^infantry$/) && !hasCat(n, /character|battleline/)),
  ].filter((n, i, all) => n && all.indexOf(n) === i);
  // The character takes the detachment's first enhancement it may.
  let extra = [];
  const enh = character && enhancementsOf(character);
  if (enh) {
    const e = [
      ...kids(enh.node, "selectionEntries", "selectionEntry"),
      ...kids(enh.node, "entryLinks", "entryLink")
        .map((l) => resolve(l)?.node)
        .filter(Boolean),
    ].find((n) => !hidden(n));
    if (e) {
      chosen.add(attr(e, "id"));
      extra = [selectionXml(e, 1)];
    }
  }
  const detachXml = `<selection name="Detachment" type="upgrade" number="1"><selections>${selectionXml(detachment, 1)}</selections></selection>`;
  const unitXml = picks.map((n) => selectionXml(n, 1, n === character ? extra : [])).join("");
  const name = `${attr(doc, "name")} - ${attr(detachment, "name")}`;
  const pts = [...(detachXml + unitXml).matchAll(/<cost name="pts" value="([\d.]+)"/g)].reduce(
    (n, m) => n + Number(m[1]),
    0,
  );
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<roster name="${esc(name)}" gameSystemName="Warhammer 40,000 10th Edition" xmlns="http://www.battlescribe.net/schema/rosterSchema">` +
    `<costs><cost name="pts" value="${pts}"/></costs>` +
    `<forces><force name="Army Roster" catalogueName="${esc(attr(doc, "name"))}"><selections>${detachXml}${unitXml}</selections></force></forces></roster>\n`;
  const file = join(out, `${f.file.replace(/\.cat$/, "").replace(/[^A-Za-z0-9]+/g, "-")}.ros`);
  writeFileSync(file, xml);
  console.log(
    `${file}: ${picks.map((n) => attr(n, "name")).join(", ")}${extra.length ? " (+ enhancement)" : ""}`,
  );
}
