// The translation catalogs (#35, docs/translating.md).
//
//   node scripts/i18n.mjs           update src/i18n/messages.pot from the code, and add new
//                                   strings to every src/i18n/locales/*.po (untranslated)
//   node scripts/i18n.mjs --check   CI: fail when the catalogs are out of date with the code, or
//                                   when the UI has text that isn't wrapped in t()
//
// Strings are found as t("…"), tc("context", "…") and tn(n, "…one", "…other") calls with
// literal text. Text in JSX, and title / placeholder / aria-label / alt / label attributes, must
// go through them; mark a deliberate exception with an {/* i18n-ignore */} or // i18n-ignore
// comment on the line.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const POT = join(SRC, "i18n/messages.pot");
const LOCALES = join(SRC, "i18n/locales");
const check = process.argv.includes("--check");

/** Files not read at all: tests, type declarations, and the helpers themselves. */
const SKIP = /(\.test\.tsx?$|\.d\.ts$|\/i18n\/(index|po)\.ts$)/;
/** Folders whose text isn't the app's UI (dev tools, the engine's data, players' packages): their t() calls
 * still count, but unwrapped text there isn't flagged. */
const NOT_UI = /(\/dev\/|\/soak\/|\/sdk\/|\/core\/|\/sandbox\/)/;
const ATTRS = new Set(["title", "placeholder", "aria-label", "alt", "label"]);
const words = (s) => /[A-Za-z]{2,}/.test(s);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const found = new Map(); // key → { context, id, plural, refs }
const raw = []; // UI text not wrapped
const bad = []; // t() calls without literal text

const key = (id, context) => (context ? `${context}\u0004${id}` : id);
const literal = (n) =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;

for (const path of files(SRC)) {
  const file = relative(ROOT, path);
  if (SKIP.test("/" + file)) continue;
  const text = readFileSync(path, "utf8");
  const src = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = text.split("\n");
  const lineOf = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line;
  const ignored = (n) => {
    const l = lineOf(n);
    return /i18n-ignore/.test(lines[l] ?? "") || /i18n-ignore/.test(lines[l - 1] ?? "");
  };
  /** Whether a string ends up on screen: inside a JSX child or a text attribute's {…}, not via a call or a key. */
  const shown = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) || ts.isPropertyAssignment(p) || ts.isElementAccessExpression(p))
        return false;
      if (ts.isBinaryExpression(p) && /^(===|!==|==|!=|in)$/.test(p.operatorToken.getText())) return false;
      if (ts.isJsxExpression(p)) {
        const at = p.parent;
        return (
          ts.isJsxElement(at) ||
          ts.isJsxFragment(at) ||
          (ts.isJsxAttribute(at) && ATTRS.has(at.name.getText()))
        );
      }
      // A plain attribute value (type="number") is checked as an attribute, not as shown text.
      if (ts.isJsxAttribute(p) || ts.isJsxElement(p) || ts.isBlock(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  };
  const add = (n, id, context, plural) => {
    const k = key(id, context);
    const e = found.get(k) ?? { context, id, plural, refs: [] };
    e.refs.push(`${file}:${lineOf(n) + 1}`);
    found.set(k, e);
  };
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      const [a, b, c] = n.arguments;
      if (name === "t" && a) {
        const id = literal(a);
        if (id === undefined) bad.push(`${file}:${lineOf(n) + 1}: t() needs literal text`);
        else add(n, id);
      } else if (name === "tc" && a && b) {
        const context = literal(a);
        const id = literal(b);
        if (context === undefined || id === undefined)
          bad.push(`${file}:${lineOf(n) + 1}: tc() needs literal text`);
        else add(n, id, context);
      } else if (name === "tn" && b && c) {
        const one = literal(b);
        const other = literal(c);
        if (one === undefined || other === undefined)
          bad.push(`${file}:${lineOf(n) + 1}: tn() needs literal text`);
        else add(n, one, undefined, other);
      }
    }
    if (file.endsWith(".tsx") && !NOT_UI.test("/" + file)) {
      if (ts.isJsxText(n) && words(n.text) && !ignored(n))
        raw.push(`${file}:${lineOf(n) + 1}: ${n.text.trim().slice(0, 60)}`);
      // Text in an expression shown in JSX ({ok ? "Yes" : `${n} left`}), unless it goes through a call.
      if (
        (ts.isStringLiteral(n) || ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
        shown(n) &&
        !ignored(n)
      ) {
        // Only the template's own text counts, not what goes into its ${…} (a t() call, say).
        const s = ts.isTemplateExpression(n)
          ? [n.head.text, ...n.templateSpans.map((x) => x.literal.text)].join(" ")
          : n.text;
        if (words(s)) raw.push(`${file}:${lineOf(n) + 1}: ${n.getText().slice(0, 60)}`);
      }
      if (
        ts.isJsxAttribute(n) &&
        ATTRS.has(n.name.getText()) &&
        n.initializer &&
        ts.isStringLiteral(n.initializer)
      ) {
        if (words(n.initializer.text) && !ignored(n))
          raw.push(`${file}:${lineOf(n) + 1}: ${n.name.getText()}="${n.initializer.text.slice(0, 50)}"`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}

/**
 * The built-in games' own words (UX 256), shown through gameText() with the "game" context: phase and
 * action names in src/core/content/examples, and lesson titles and summaries in examples/lessons.
 * Rule and keyword names stay as they are, since army lists use them.
 */
const DATA = [
  ...readdirSync(join(SRC, "core/content/examples")).map((f) => join(SRC, "core/content/examples", f)),
  ...readdirSync(join(ROOT, "examples/lessons")).map((f) => join(ROOT, "examples/lessons", f)),
].filter((f) => /\.(ts|js)$/.test(f) && !/\.test\./.test(f));
for (const path of DATA) {
  const file = relative(ROOT, path);
  const text = readFileSync(path, "utf8");
  const src = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lesson = file.startsWith("examples/lessons");
  const prop = (o, name) =>
    o.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === name)?.initializer;
  const take = (n) => {
    const id = literal(n);
    if (!id) return;
    const k = key(id, "game");
    const e = found.get(k) ?? { context: "game", id, refs: [] };
    e.refs.push(`${file}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    found.set(k, e);
  };
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      if (lesson) {
        for (const name of ["title", "summary"]) {
          const v = prop(n, name);
          if (v) take(v);
        }
      } else {
        const kind = prop(n, "kind");
        const inActions =
          ts.isArrayLiteralExpression(n.parent) &&
          ts.isPropertyAssignment(n.parent.parent) &&
          n.parent.parent.name.getText() === "actions";
        if ((kind && literal(kind) === "phase") || inActions) {
          const v = prop(n, "name");
          if (v) take(v);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}

// The template, sorted by where each string first appears.
const entries = [...found.values()].sort((a, b) =>
  a.refs[0] < b.refs[0] ? -1 : a.refs[0] > b.refs[0] ? 1 : 0,
);
const q = (s) => JSON.stringify(s);
const block = (e, str) => {
  const lines = e.refs.slice(0, 6).map((r) => `#: ${r}`);
  if (e.fuzzy) lines.push("#, fuzzy");
  if (e.context !== undefined) lines.push(`msgctxt ${q(e.context)}`);
  lines.push(`msgid ${q(e.id)}`);
  if (e.plural !== undefined) {
    lines.push(`msgid_plural ${q(e.plural)}`);
    (str?.length ? str : ["", ""]).forEach((s, i) => lines.push(`msgstr[${i}] ${q(s ?? "")}`));
  } else lines.push(`msgstr ${q(str?.[0] ?? "")}`);
  return lines.join("\n");
};
const header = (lang) =>
  [
    "# Open Battle's interface text. See docs/translating.md.",
    "# Entries marked fuzzy are machine drafts waiting for a native speaker: remove the flag once checked.",
    'msgid ""',
    'msgstr ""',
    `"Content-Type: text/plain; charset=UTF-8\\n"`,
    ...(lang ? [`"Language: ${lang}\\n"`] : []),
    `"X-Plural-Order: zero one two few many other (those the language uses)\\n"`,
  ].join("\n");
const pot = `${header()}\n\n${entries.map((e) => block(e)).join("\n\n")}\n`;

// Each language's catalog, with the template's strings in the template's order.
const { parsePo } = await import("../src/i18n/po.ts");
let missing = 0;
const report = [];
const locales = readdirSync(LOCALES).filter((f) => f.endsWith(".po"));
const updated = {};
for (const name of locales) {
  const path = join(LOCALES, name);
  const old = new Map(
    parsePo(readFileSync(path, "utf8"))
      .filter((e) => e.id)
      .map((e) => [key(e.id, e.context), e]),
  );
  let done = 0;
  let drafts = 0;
  const body = entries.map((e) => {
    const have = old.get(key(e.id, e.context));
    if (!have) missing++;
    if (have?.str.some(Boolean)) have.fuzzy ? drafts++ : done++;
    return block({ ...e, fuzzy: have?.fuzzy }, have?.str);
  });
  const lang = name.replace(/\.po$/, "");
  updated[path] = `${header(lang)}\n\n${body.join("\n\n")}\n`;
  report.push(
    `${lang}: ${done} checked, ${drafts} drafts, ${entries.length - done - drafts} untranslated of ${entries.length}`,
  );
}

if (check) {
  const problems = [];
  if (bad.length) problems.push(`Translated text must be literal:\n  ${bad.join("\n  ")}`);
  if (raw.length)
    problems.push(
      `UI text not wrapped in t() (${raw.length}):\n  ${raw.slice(0, process.env.I18N_ALL ? Infinity : 80).join("\n  ")}${raw.length > 80 && !process.env.I18N_ALL ? "\n  …" : ""}`,
    );
  // Where a string is used (#: lines) moves with every edit, so only the strings themselves count.
  const strings = (text) => text.replace(/^#:.*\n/gm, "");
  let stale = false;
  try {
    stale = strings(readFileSync(POT, "utf8")) !== strings(pot);
  } catch {
    stale = true;
  }
  for (const [path, text] of Object.entries(updated))
    if (strings(readFileSync(path, "utf8")) !== strings(text)) stale = true;
  if (stale || missing)
    problems.push("The catalogs are out of date with the code: run `pnpm i18n` and commit the result.");
  console.log(report.join("\n"));
  if (problems.length) {
    console.error(problems.join("\n\n"));
    // Not process.exit: a long list must reach the end of the pipe first.
    process.exitCode = 1;
  } else console.log(`${entries.length} strings, catalogs up to date.`);
} else {
  writeFileSync(POT, pot);
  for (const [path, text] of Object.entries(updated)) writeFileSync(path, text);
  console.log(`${entries.length} strings.\n${report.join("\n")}`);
  if (raw.length)
    console.log(`${raw.length} bits of UI text aren't wrapped in t() yet (pnpm i18n:check lists them).`);
}
