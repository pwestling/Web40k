import ts from "typescript";

/**
 * The module workshop's type checker (#43): a TypeScript language service
 * over one draft, checked as JavaScript against the SDK's declarations
 * (vite.config.ts `virtual:sdk-types`). It runs in a worker (typesWorker.ts).
 *
 * A draft is plain JavaScript with no annotations, so before checking, the
 * checker gives its three known shapes their SDK types, as JSDoc it adds out
 * of sight: `const system` is a GameSystem, `export const manifest` a
 * Manifest, and the default export a package whose module's app is a
 * PackageApp. Everything inside them then gets its type from the SDK:
 * a mistyped key is flagged where it is written, and `ctx` and `view` in an
 * action or procedure are the SDK's, so a wrong call is underlined. A helper
 * written outside them takes its parameters' types from the SDK's names for
 * them (`ctx`, `view`, `state`, `actor`), as the templates name them.
 * Positions are mapped back to the draft as written.
 */

export interface TypeProblem {
  from: number;
  to: number;
  message: string;
  severity: "error" | "warning";
}

export interface TypeHover {
  from: number;
  to: number;
  text: string;
  doc: string;
}

export interface TypeCompletion {
  label: string;
  type: string;
  /** Sort position, as TypeScript ranks them. */
  sort: string;
}

/** The SDK's three shapes, and what a package's code may use (no DOM: it runs in a worker). */
const WORKSHOP = `import type { PackageContents, GameModule, PackageApp, Ctx as SdkCtx, GameView as SdkView, Actor as SdkActor } from "./src/sdk/index";
import type { GameSystem } from "./src/core/content/schema";
import type { GameState as SdkState } from "./src/core/types";
import type { Manifest as PackageManifest } from "./src/packages/manifest";
export type Draft = Omit<PackageContents, "module"> & { module?: GameModule<PackageApp> };
export type System = GameSystem;
export type Manifest = PackageManifest;
export type Ctx = SdkCtx;
export type GameView = SdkView;
export type GameState = SdkState;
export type Actor = SdkActor;
declare global {
  var console: { log(...a: unknown[]): void; info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
}
`;

const DRAFT = "/draft.js";

const OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts"],
  types: [],
  // Plain JavaScript: no null checks or implicit-any complaints, only real mismatches.
  strict: false,
  skipLibCheck: true,
};

/** Text added to the draft before checking, at a position in the draft as written. */
interface Insert {
  at: number;
  text: string;
}

/** Parameters a helper names as the SDK does, and the SDK's type for each. */
const PARAMS: Record<string, string> = { ctx: "Ctx", view: "GameView", state: "GameState", actor: "Actor" };

/** JSDoc giving a top-level helper's SDK-named parameters their types, unless it types them itself. */
function paramDoc(fn: ts.SignatureDeclaration, owner: ts.Node): string | null {
  if (ts.getJSDocTags(owner).some((t) => ts.isJSDocParameterTag(t) || ts.isJSDocTypeTag(t))) return null;
  const tags = fn.parameters
    .filter((p) => ts.isIdentifier(p.name) && PARAMS[p.name.text])
    .map((p) => {
      const name = (p.name as ts.Identifier).text;
      return ` * @param {import("/workshop").${PARAMS[name]}} ${name}\n`;
    });
  return tags.length ? `/**\n${tags.join("")} */\n` : null;
}

/** Where the SDK's types go in a draft. */
export function typeInserts(source: string): Insert[] {
  const file = ts.createSourceFile(DRAFT, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const out: Insert[] = [];
  const annotate = (s: ts.Statement, type: string) =>
    out.push({ at: s.getStart(file), text: `/** @type {import("/workshop").${type}} */\n` });
  for (const s of file.statements) {
    if (ts.isFunctionDeclaration(s)) {
      const doc = paramDoc(s, s);
      if (doc) out.push({ at: s.getStart(file), text: doc });
    } else if (ts.isVariableStatement(s) && s.declarationList.declarations.length === 1) {
      const d = s.declarationList.declarations[0]!;
      const init = d.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const doc = paramDoc(init, s);
        if (doc) out.push({ at: s.getStart(file), text: doc });
        continue;
      }
      if (!ts.isIdentifier(d.name) || !init || !ts.isObjectLiteralExpression(init)) continue;
      const exported = s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (d.name.text === "system" && !exported) annotate(s, "System");
      if (d.name.text === "manifest" && exported) annotate(s, "Manifest");
    } else if (ts.isExportAssignment(s) && !s.isExportEquals) {
      out.push({ at: s.expression.getStart(file), text: `/** @type {import("/workshop").Draft} */ (` });
      out.push({ at: s.expression.getEnd(), text: ")" });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The draft as checked, and position maps both ways. */
function prepare(source: string) {
  const inserts = typeInserts(source);
  let text = "";
  let last = 0;
  for (const i of inserts) {
    text += source.slice(last, i.at) + i.text;
    last = i.at;
  }
  text += source.slice(last);
  /** Draft position → checked position: text inserted at a spot comes before it. */
  const toChecked = (pos: number) => {
    let shift = 0;
    for (const i of inserts) if (i.at <= pos) shift += i.text.length;
    return pos + shift;
  };
  /** Checked position → draft position; inside added text, where it was added. */
  const toDraft = (pos: number) => {
    let shift = 0;
    for (const i of inserts) {
      const start = i.at + shift;
      if (pos < start) break;
      if (pos < start + i.text.length) return i.at;
      shift += i.text.length;
    }
    return pos - shift;
  };
  return { text, toChecked, toDraft };
}

/** Letters to change to turn one name into another. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length]!;
}

/**
 * The compiler's commonest messages in the workshop's words (UX 330). A
 * mistyped key's suggestion is one the object doesn't have yet: `roundz` next
 * to `round` means `rounds`, not the `round` already written.
 */
function plain(d: ts.Diagnostic, message: string, program: ts.Program | undefined): string {
  const unknownKey =
    /^Object literal may only specify known properties, (?:and|but) '([^']+)' does not exist in type '([^']+)'\.(?: Did you mean to write '([^']+)'\?)?$/.exec(
      message,
    );
  if (unknownKey) {
    const [, key, , suggested] = unknownKey;
    const better = program && d.start !== undefined ? otherKey(program, d.start, key!, suggested) : suggested;
    return better ? `${key} isn't a setting here. Did you mean ${better}?` : `${key} isn't a setting here.`;
  }
  const missing =
    /^Property '([^']+)' does not exist on type '([^']+)'\.(?: Did you mean '([^']+)'\?)?$/.exec(message);
  if (missing) {
    const [, key, type, suggested] = missing;
    return suggested ? `${type} has no ${key}. Did you mean ${suggested}?` : `${type} has no ${key}.`;
  }
  return message;
}

/** A key the object literal at `pos` could mean instead of `key`, not one it already has. */
function otherKey(program: ts.Program, pos: number, key: string, suggested: string | undefined) {
  const file = program.getSourceFile(DRAFT);
  if (!file) return suggested;
  let node: ts.Node | undefined = findNode(file, pos);
  while (node && !ts.isObjectLiteralExpression(node)) node = node.parent;
  if (!node) return suggested;
  const has = new Set(
    node.properties.map((p) =>
      p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "",
    ),
  );
  if (suggested && !has.has(suggested)) return suggested;
  const type = program.getTypeChecker().getContextualType(node);
  const names = type?.getProperties().map((p) => p.name) ?? [];
  const near = names
    .filter((n) => !has.has(n))
    .map((n) => ({ n, d: distance(key.toLowerCase(), n.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(key.length / 3)))
    .sort((a, b) => a.d - b.d);
  return near[0]?.n;
}

function findNode(node: ts.Node, pos: number): ts.Node | undefined {
  for (const child of node.getChildren())
    if (child.getStart() <= pos && pos < child.getEnd()) return findNode(child, pos) ?? child;
  return undefined;
}

export function createChecker(files: Record<string, string>) {
  const lib: Record<string, string | undefined> = { ...files, "/workshop.d.ts": WORKSHOP };
  const dirs = new Set<string>(["/"]);
  for (const f of Object.keys(lib)) {
    const parts = f.split("/").slice(1, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(`/${parts.slice(0, i).join("/")}`);
  }
  let draft = prepare("");
  let version = 0;
  const snapshots = new Map<string, ts.IScriptSnapshot>();
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => OPTIONS,
    getScriptFileNames: () => [DRAFT, "/workshop.d.ts"],
    getScriptVersion: (f) => (f === DRAFT ? String(version) : "0"),
    getScriptSnapshot(f) {
      if (f === DRAFT) return ts.ScriptSnapshot.fromString(draft.text);
      const text = lib[f];
      if (text === undefined) return undefined;
      let snap = snapshots.get(f);
      if (!snap) snapshots.set(f, (snap = ts.ScriptSnapshot.fromString(text)));
      return snap;
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "/lib/lib.es2023.d.ts",
    fileExists: (f) => f === DRAFT || f in lib,
    readFile: (f) => (f === DRAFT ? draft.text : lib[f]),
    directoryExists: (d) => dirs.has(d.replace(/\/$/, "") || "/"),
    getDirectories: () => [],
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  let current: string | null = null;
  const load = (source: string) => {
    if (source === current) return;
    current = source;
    draft = prepare(source);
    version++;
  };
  const flat = (m: string | ts.DiagnosticMessageChain) =>
    ts
      .flattenDiagnosticMessageText(m, "\n")
      // The added annotations name the SDK's types by a path the author never wrote.
      .replaceAll('import("/workshop").', "")
      // A long list of names (the game's event types) says how many, and the "Did you mean" follows.
      .replace(
        /is not assignable to type '((?:"[^"]*" \| )+)\.\.\. (\d+) more \.\.\.((?: \| "[^"]*")+)'/g,
        (_m, a: string, n: string, b: string) => {
          const count = a.split(" | ").length - 1 + Number(n) + b.split(" | ").length - 1;
          return `isn't one of the ${count} names the SDK knows`;
        },
      );

  return {
    /** Type and syntax problems in a draft, at their place in the draft. */
    problems(source: string): TypeProblem[] {
      load(source);
      const all = [...service.getSyntacticDiagnostics(DRAFT), ...service.getSemanticDiagnostics(DRAFT)];
      const program = service.getProgram();
      return all.map((d) => {
        const start = d.start ?? 0;
        const from = Math.min(draft.toDraft(start), source.length);
        const to = Math.min(Math.max(draft.toDraft(start + (d.length ?? 0)), from), source.length);
        return {
          from,
          to,
          message: plain(d, flat(d.messageText), program),
          severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        };
      });
    },

    /** What's under a position: its type and the SDK's comment for it. */
    hover(source: string, pos: number): TypeHover | null {
      load(source);
      const info = service.getQuickInfoAtPosition(DRAFT, draft.toChecked(pos));
      if (!info) return null;
      // The type without the compiler's "(property)" and "(parameter)" tags (UX 330).
      const text = flat(ts.displayPartsToString(info.displayParts)).replace(
        /^\((?:property|parameter|method|local var|const|let|var|function|alias)\) /,
        "",
      );
      const doc = ts.displayPartsToString(info.documentation);
      // Nothing worth saying: no comment, and a type the checker doesn't know ("any").
      if (!doc && /(^|: )any$/.test(text)) return null;
      return {
        from: draft.toDraft(info.textSpan.start),
        to: draft.toDraft(info.textSpan.start + info.textSpan.length),
        text,
        doc,
      };
    },

    /** Members offered after a dot (`ctx.`, `view.units[id].`), from the types. */
    complete(source: string, pos: number): TypeCompletion[] {
      load(source);
      const list = service.getCompletionsAtPosition(DRAFT, draft.toChecked(pos), {});
      if (!list?.isMemberCompletion) return [];
      return list.entries.map((e) => ({ label: e.name, type: e.kind, sort: e.sortText }));
    },

    /** One offered member's type and comment. */
    detail(source: string, pos: number, name: string): { text: string; doc: string } | null {
      load(source);
      const d = service.getCompletionEntryDetails(
        DRAFT,
        draft.toChecked(pos),
        name,
        {},
        undefined,
        {},
        undefined,
      );
      if (!d) return null;
      return {
        text: flat(ts.displayPartsToString(d.displayParts)),
        doc: ts.displayPartsToString(d.documentation),
      };
    },
  };
}

export type Checker = ReturnType<typeof createChecker>;
