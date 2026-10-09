#!/usr/bin/env node
/**
 * Real-input check for the Conquest import (#66): builds a roster per faction
 * from the public BSData Conquest catalogue, the way BattleScribe saves one,
 * with every regiment and character the catalogue lists. Nothing fetched or
 * written is committed (see scripts/bsdata.mjs for the 40k one).
 *
 *   node scripts/bsdata-conquest.mjs [outDir]     (default: .bsdata/conquest-rosters)
 *
 * Then `BSDATA_CONQUEST=.bsdata/conquest-rosters pnpm vitest run src/systems/conquest/bsdata.test.ts`
 * imports each roster and prints which special rules play themselves.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";

const REPO = "https://github.com/BSData/conquest-the-last-argument-of-kings.git";
const out = process.argv[2] ?? ".bsdata/conquest-rosters";
const src = join(".bsdata", "conquest");

if (!existsSync(src)) {
  mkdirSync(".bsdata", { recursive: true });
  execFileSync("git", ["clone", "-q", "--depth", "1", REPO, src], { stdio: "inherit" });
}
mkdirSync(out, { recursive: true });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

const byId = new Map();
function index(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(index);
  if (node["@_id"] && !byId.has(node["@_id"])) byId.set(node["@_id"], node);
  for (const [k, v] of Object.entries(node)) if (!k.startsWith("@_") && k !== "#text") index(v);
}
const docs = {};
for (const f of readdirSync(src).filter((f) => /\.(cat|gst)$/.test(f))) {
  docs[f] = parser.parse(readFileSync(join(src, f), "utf8"));
  index(docs[f]);
}

const kids = (node, plural, singular) => node?.[plural]?.[0]?.[singular] ?? [];
const attr = (node, k) => node?.[`@_${k}`] ?? "";
const textOf = (v) => (typeof v === "string" ? v : (v?.["#text"] ?? ""));
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A link's name with its "append" modifiers ("Cleave" + "1" = "Cleave 1"). */
function linkName(link, fallback) {
  let name = attr(link, "name") || fallback;
  for (const m of kids(link, "modifiers", "modifier"))
    if (attr(m, "field") === "name" && attr(m, "type") === "append") name = `${name} ${attr(m, "value").trim()}`;
    else if (attr(m, "field") === "name" && attr(m, "type") === "set") name = attr(m, "value");
  return name;
}

function profileXml(p) {
  const chars = kids(p, "characteristics", "characteristic")
    .map((c) => `<characteristic name="${esc(attr(c, "name"))}">${esc(textOf(c))}</characteristic>`)
    .join("");
  return `<profile name="${esc(attr(p, "name"))}" typeName="${esc(attr(p, "typeName"))}"><characteristics>${chars}</characteristics></profile>`;
}
const ruleXml = (name, r) =>
  `<rule name="${esc(name)}"><description>${esc(textOf(r.description?.[0]))}</description></rule>`;

/** Profiles and rules of an entry, following its info links. */
function info(node) {
  const profiles = kids(node, "profiles", "profile").filter((p) => attr(p, "hidden") !== "true");
  const rules = kids(node, "rules", "rule").map((r) => ruleXml(attr(r, "name"), r));
  for (const l of kids(node, "infoLinks", "infoLink")) {
    const t = byId.get(attr(l, "targetId"));
    if (!t) continue;
    if (attr(l, "type") === "profile") profiles.push(t);
    else if (attr(l, "type") === "rule") rules.push(ruleXml(linkName(l, attr(t, "name")), t));
  }
  return { profiles, rules };
}

const ptsOf = (node) =>
  kids(node, "costs", "cost")
    .filter((c) => attr(c, "name") === "Points")
    .reduce((n, c) => n + Number(attr(c, "value")), 0);

function selectionXml(node) {
  const { profiles, rules } = info(node);
  const pts = ptsOf(node);
  return (
    `<selection name="${esc(attr(node, "name"))}" type="${attr(node, "type")}" number="1">` +
    (pts ? `<costs><cost name="pts" value="${pts}"/></costs>` : "") +
    (rules.length ? `<rules>${rules.join("")}</rules>` : "") +
    (profiles.length ? `<profiles>${profiles.map(profileXml).join("")}</profiles>` : "") +
    `</selection>`
  );
}

for (const [file, doc] of Object.entries(docs)) {
  const cat = doc.catalogue?.[0];
  if (!cat) continue;
  // Every regiment and character the catalogue lists (they are hidden until a warband picks them).
  const units = kids(cat, "selectionEntries", "selectionEntry").filter((n) =>
    ["unit", "model"].includes(attr(n, "type")),
  );
  const body = units.map(selectionXml).join("");
  const pts = units.reduce((n, u) => n + ptsOf(u), 0);
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<roster name="${esc(attr(cat, "name"))}" gameSystemName="Conquest" xmlns="http://www.battlescribe.net/schema/rosterSchema">` +
    `<costs><cost name="pts" value="${pts}"/></costs>` +
    `<forces><force name="Army" catalogueName="${esc(attr(cat, "name"))}"><selections>${body}</selections></force></forces></roster>\n`;
  const path = join(out, `${file.replace(/\.cat$/, "").replace(/[^A-Za-z0-9]+/g, "-")}.ros`);
  writeFileSync(path, xml);
  console.log(`${path}: ${units.length} regiments and characters`);
}
