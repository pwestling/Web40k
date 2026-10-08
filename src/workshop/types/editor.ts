import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { hoverTooltip } from "@codemirror/view";
import { types } from "./client";

/**
 * The editor's side of the type checker (#43): problems underlined as the
 * draft is typed, a tooltip with the type and the SDK's comment on hover, and
 * members after a dot from the types themselves.
 */
export const typeProblems = linter(
  async (view): Promise<Diagnostic[]> => {
    const source = view.state.doc.toString();
    const problems = await types.problems(source);
    // The text moved on while this was checked: the next check covers it.
    if (view.state.doc.toString() !== source) return [];
    return problems.map((p) => ({
      from: p.from,
      to: Math.max(p.to, Math.min(p.from + 1, source.length)),
      severity: p.severity,
      message: p.message,
      source: "types",
    }));
  },
  { delay: 400 },
);

export const typeHover = hoverTooltip(async (view, pos) => {
  const h = await types.hover(view.state.doc.toString(), pos);
  if (!h || !h.text) return null;
  return {
    pos: h.from,
    end: h.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-type-hover";
      // The SDK's comment first, in words; the type under it, for those who want it (UX 330).
      if (h.doc) {
        const doc = document.createElement("p");
        doc.textContent = h.doc;
        dom.append(doc);
      }
      const code = document.createElement("code");
      code.textContent = h.text;
      dom.append(code);
      return { dom };
    },
  };
});

const KIND: Record<string, string> = {
  method: "method",
  function: "function",
  property: "property",
  getter: "property",
  const: "constant",
  let: "variable",
  var: "variable",
  "local var": "variable",
  string: "text",
};

/** Members after a dot, or null to let the SDK table answer (completions.ts). */
export async function typeCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const word = context.matchBefore(/[\w$]*/);
  if (!word || context.state.sliceDoc(word.from - 1, word.from) !== ".") return null;
  const source = context.state.doc.toString();
  const entries = await types.complete(source, context.pos);
  if (!entries.length || context.aborted) return null;
  const options: Completion[] = entries
    .sort((a, b) => a.sort.localeCompare(b.sort) || a.label.localeCompare(b.label))
    .map((e, i) => ({
      label: e.label,
      type: KIND[e.type] ?? "property",
      boost: -i / entries.length,
      info: async () => {
        const d = await types.detail(source, context.pos, e.label);
        if (!d) return null;
        const dom = document.createElement("div");
        dom.className = "cm-type-hover";
        const code = document.createElement("code");
        code.textContent = d.text;
        dom.append(code);
        if (d.doc) {
          const p = document.createElement("p");
          p.textContent = d.doc;
          dom.append(p);
        }
        return dom;
      },
    }));
  return { from: word.from, options, validFor: /^[\w$]*$/ };
}
