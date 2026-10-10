/**
 * Lua table literals, read as data (#75). Yellowscribe (and BS2TTS before it)
 * writes each unit's datasheet into the leader model's LuaScript as
 * `local unitData = { … }` ahead of its own script; this reads that table
 * without running anything. Strings ("…", '…', [[…]], [=[…]=]), numbers,
 * booleans, nil, nested tables, `key = v`, `["key"] = v` and positional
 * entries; stray separators are skipped. A table with only positional
 * entries becomes an array, any other an object.
 */

type LuaValue = string | number | boolean | null | LuaValue[] | { [key: string]: LuaValue };

class Reader {
  i = 0;
  constructor(readonly s: string) {}

  skip(): void {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
      if (!this.s.startsWith("--", this.i)) return;
      this.i += 2;
      const long = this.longOpen();
      if (long !== null) {
        const end = this.s.indexOf(`]${"=".repeat(long)}]`, this.i);
        this.i = end < 0 ? this.s.length : end + long + 2;
      } else {
        const nl = this.s.indexOf("\n", this.i);
        this.i = nl < 0 ? this.s.length : nl + 1;
      }
    }
  }

  /** At `[[` or `[=[`: steps past it and returns its level; otherwise null and stays. */
  longOpen(): number | null {
    const m = /^\[(=*)\[/.exec(this.s.slice(this.i, this.i + 12));
    if (!m) return null;
    this.i += m[0].length;
    return m[1]!.length;
  }

  longString(level: number): string {
    const close = `]${"=".repeat(level)}]`;
    const end = this.s.indexOf(close, this.i);
    if (end < 0) throw new Error("unterminated long string");
    // Lua drops a newline straight after the opening bracket.
    const text = this.s.slice(this.i, end).replace(/^\r?\n/, "");
    this.i = end + close.length;
    return text;
  }

  quoted(q: string): string {
    let out = "";
    this.i++;
    while (this.i < this.s.length) {
      const c = this.s[this.i++]!;
      if (c === q) return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.i++] ?? "";
      out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "\n" ? "\n" : e;
    }
    throw new Error("unterminated string");
  }

  value(): LuaValue {
    this.skip();
    const c = this.s[this.i];
    if (c === "{") return this.table();
    if (c === '"' || c === "'") return this.quoted(c);
    const long = this.longOpen();
    if (long !== null) return this.longString(long);
    const word = /^(?:-?(?:0x[0-9a-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+)|[A-Za-z_]\w*)/i.exec(
      this.s.slice(this.i, this.i + 64),
    );
    if (!word) throw new Error(`unexpected ${c ?? "end"} at ${this.i}`);
    this.i += word[0].length;
    const w = word[0];
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "nil") return null;
    const n = Number(w);
    if (Number.isNaN(n)) throw new Error(`unexpected ${w}`);
    return n;
  }

  table(): LuaValue {
    this.i++; // {
    const list: LuaValue[] = [];
    const named: Record<string, LuaValue> = {};
    let keyed = false;
    for (;;) {
      this.skip();
      const c = this.s[this.i];
      if (c === undefined) throw new Error("unterminated table");
      if (c === "}") {
        this.i++;
        break;
      }
      if (c === "," || c === ";") {
        this.i++;
        continue;
      }
      let key: string | undefined;
      if (c === "[" && this.s[this.i + 1] !== "[" && this.s[this.i + 1] !== "=") {
        this.i++;
        const k = this.value();
        this.skip();
        if (this.s[this.i] !== "]") throw new Error("expected ]");
        this.i++;
        key = String(k);
        this.expectEquals();
      } else {
        const id = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(this.s.slice(this.i, this.i + 200));
        if (id) {
          key = id[1]!;
          this.i += id[0].length;
        }
      }
      const v = this.value();
      if (key === undefined) list.push(v);
      else {
        keyed = true;
        named[key] = v;
      }
    }
    if (!keyed) return list;
    list.forEach((v, n) => (named[String(n + 1)] ??= v));
    return named;
  }

  expectEquals(): void {
    this.skip();
    if (this.s[this.i] !== "=") throw new Error("expected =");
    this.i++;
  }
}

/** The table literal assigned to `name` in a script (`local name = { … }`), as data; null when absent or unreadable. */
export function luaTable(script: string, name: string): Record<string, LuaValue> | null {
  const m = new RegExp(`(?:^|[\\s;])(?:local\\s+)?${name}\\s*=\\s*\\{`).exec(script);
  if (!m) return null;
  const r = new Reader(script);
  r.i = m.index + m[0].length - 1;
  try {
    const v = r.table();
    if (Array.isArray(v)) return v.length ? Object.fromEntries(v.map((x, i) => [String(i + 1), x])) : {};
    return v as Record<string, LuaValue>;
  } catch {
    return null;
  }
}
