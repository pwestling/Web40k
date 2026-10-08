import { javascriptLanguage } from "@codemirror/lang-javascript";

/**
 * The first syntax error in a draft, found by parsing it (nothing runs): its
 * line and column (1-based), or null when it parses. When the parser only
 * notices at the very end (something opened and never closed), the bracket
 * left open is named instead, which is where the mistake usually is.
 */
export function syntaxError(source: string): { line: number; column: number } | null {
  const tree = javascriptLanguage.parser.parse(source);
  let at = -1;
  tree.iterate({
    enter: (node) => {
      if (at >= 0) return false;
      if (node.type.isError) {
        at = node.from;
        return false;
      }
    },
  });
  if (at < 0) return null;
  if (source.slice(at).trim() === "") {
    const open = unclosed(source);
    if (open >= 0) at = open;
  }
  const before = source.slice(0, at);
  return { line: before.split("\n").length, column: at - before.lastIndexOf("\n") };
}

/** Where the innermost bracket left open at the end is (strings, comments and regexes skipped), or -1. */
function unclosed(src: string): number {
  const stack: number[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  // Template literals' ${...} nest; each entry is the brace depth the template resumes at.
  const templates: number[] = [];
  let prev = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1;
      if (i <= 0) break;
      continue;
    }
    if (c === '"' || c === "'" || (c === "/" && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev))) {
      for (i++; i < src.length && src[i] !== c && src[i] !== "\n"; i++) if (src[i] === "\\") i++;
      prev = c;
      continue;
    }
    if (c === "`" || (c === "}" && templates.length && templates.at(-1) === stack.length)) {
      if (c === "}") {
        templates.pop();
        stack.pop();
      }
      for (i++; i < src.length && src[i] !== "`"; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "$" && src[i + 1] === "{") {
          stack.push(i + 1);
          templates.push(stack.length);
          i++;
          break;
        }
      }
      prev = "`";
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(i);
    else if (c in pairs) {
      const top = stack.at(-1);
      if (top === undefined || src[top] !== pairs[c]) return top ?? i;
      stack.pop();
    }
    if (!/\s/.test(c)) prev = c;
  }
  return stack.at(-1) ?? -1;
}
