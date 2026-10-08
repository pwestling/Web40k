/**
 * A rules package's manifest, read from its source WITHOUT running it: the
 * consent sheet shows what a package is and adds before any of its code may
 * run. The manifest is the `export const manifest = { ... }` literal at the top
 * of the bundle (see the game modules spec), parsed as data.
 */
export interface Manifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  api: number;
  /** A lesson package (src/teach) is data only: its lessons are read like the manifest, never run. */
  kind: "system" | "extension" | "lesson";
  systems: string[];
  requires: { id: string; hash?: string }[];
  adds?: string;
  changelog?: string;
}

export type ManifestResult = { manifest: Manifest } | { error: string };

export const NOT_LITERAL = "manifest must be a plain literal";

export function readManifest(source: string): ManifestResult {
  const m = /export\s+const\s+manifest\s*(?::[^=]+)?=\s*/.exec(source);
  if (!m) return { error: "This file has no package manifest." };
  let value: unknown;
  try {
    value = new LiteralParser(source, m.index + m[0].length).value();
  } catch {
    // Identifiers, calls, spreads and template expressions would need the code to run.
    return { error: NOT_LITERAL };
  }
  return check(value);
}

/** Another `export const <name> = <literal>` in a package, read as data the same way (undefined if absent). */
export function readLiteral(
  source: string,
  name: string,
): { value: unknown } | { error: string } | undefined {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*`).exec(source);
  if (!m) return undefined;
  try {
    return { value: new LiteralParser(source, m.index + m[0].length).value() };
  } catch (e) {
    return { error: `${name} must be a plain literal (${e instanceof Error ? e.message : String(e)})` };
  }
}

function check(v: unknown): ManifestResult {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: NOT_LITERAL };
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string) : null);
  const id = str("id");
  const name = str("name");
  const version = str("version");
  const missing = [
    !id && "id",
    !name && "name",
    !version && "version",
    typeof o.api !== "number" && "api",
    o.kind !== "system" && o.kind !== "extension" && o.kind !== "lesson" && "kind",
    !(Array.isArray(o.systems) && o.systems.every((x) => typeof x === "string")) && "systems",
  ].filter(Boolean);
  if (missing.length) return { error: `The manifest is missing ${missing.join(", ")}.` };
  const requires = Array.isArray(o.requires)
    ? o.requires.flatMap((r) => {
        if (typeof r === "string") return [{ id: r }];
        if (r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string") {
          const { id: rid, hash } = r as { id: string; hash?: unknown };
          return [typeof hash === "string" ? { id: rid, hash } : { id: rid }];
        }
        return [];
      })
    : [];
  const manifest: Manifest = {
    id: id!,
    name: name!,
    version: version!,
    api: o.api as number,
    kind: o.kind as Manifest["kind"],
    systems: o.systems as string[],
    requires,
  };
  const author = str("author");
  const adds = str("adds");
  const changelog = str("changelog");
  if (author) manifest.author = author;
  if (adds) manifest.adds = adds;
  if (changelog) manifest.changelog = changelog;
  return { manifest };
}

/** Objects, arrays, strings, numbers, booleans and null, as written in JS (comments and trailing commas allowed). */
class LiteralParser {
  constructor(
    private readonly s: string,
    private i: number,
  ) {}

  value(): unknown {
    this.space();
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'" || c === "`") return this.string();
    const word = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)/i.exec(this.s.slice(this.i, this.i + 40));
    if (!word) throw new Error(`unexpected "${this.s.slice(this.i, this.i + 12)}"`);
    this.i += word[0].length;
    const w = word[0];
    return w === "true" ? true : w === "false" ? false : w === "null" ? null : Number(w);
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    for (;;) {
      this.space();
      if (this.s[this.i] === "}") {
        this.i++;
        return out;
      }
      const c = this.s[this.i];
      let key: string;
      if (c === '"' || c === "'") key = this.string();
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 64));
        if (!m) throw new Error("expected a key");
        key = m[0];
        this.i += key.length;
      }
      this.space();
      if (this.s[this.i++] !== ":") throw new Error(`expected ":" after ${key}`);
      // Plain data only: no prototype tricks.
      const v = this.value();
      if (key !== "__proto__" && key !== "constructor" && key !== "prototype") out[key] = v;
      this.space();
      if (this.s[this.i] === ",") this.i++;
      else if (this.s[this.i] !== "}") throw new Error("expected , or }");
    }
  }

  private array(): unknown[] {
    const out: unknown[] = [];
    this.i++;
    for (;;) {
      this.space();
      if (this.s[this.i] === "]") {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.space();
      if (this.s[this.i] === ",") this.i++;
      else if (this.s[this.i] !== "]") throw new Error("expected , or ]");
    }
  }

  private string(): string {
    const q = this.s[this.i++];
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++]!;
      if (c === q) return out;
      if (q === "`" && c === "$" && this.s[this.i] === "{")
        throw new Error("template expressions aren't data");
      if (c === "\\") {
        const e = this.s[this.i++]!;
        out += e === "n" ? "\n" : e === "t" ? "\t" : e;
      } else out += c;
    }
    throw new Error("unterminated string");
  }

  private space(): void {
    for (;;) {
      const rest = this.s.slice(this.i, this.i + 2);
      if (/^\s/.test(rest)) this.i++;
      else if (rest === "//") {
        const nl = this.s.indexOf("\n", this.i);
        this.i = nl < 0 ? this.s.length : nl + 1;
      } else if (rest === "/*") {
        const end = this.s.indexOf("*/", this.i + 2);
        this.i = end < 0 ? this.s.length : end + 2;
      } else return;
    }
  }
}

/** The short fingerprint players compare: the first eight hex characters in two groups. */
export function fingerprint(hash: string): string {
  return `${hash.slice(0, 4)} ${hash.slice(4, 8)}`;
}

export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
