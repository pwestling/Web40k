import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import skirmish from "../../examples/workshop/skirmish.js?raw";
import ranked from "../../examples/workshop/ranked.js?raw";
import activations from "../../examples/workshop/activations.js?raw";
import { fileName, manifestOf, prText, problems } from "./drafts";
import { CTX, sdkCompletions, VIEW } from "./completions";

describe("module workshop drafts", () => {
  it("the starter templates are whole games with nothing to fix", () => {
    for (const source of [skirmish, ranked, activations]) expect(problems(source)).toEqual([]);
  });

  it("says what a draft is missing", () => {
    expect(problems("const x = 1;")[0]).toMatch(/manifest/);
    const extension = skirmish.replace('kind: "system"', 'kind: "extension"');
    expect(problems(extension)[0]).toMatch(/kind/);
    expect(problems(skirmish.replace("export default", "const game ="))).toEqual([
      "Export the game: export default { module }.",
    ]);
  });

  it("names downloads and pull requests from the manifest", () => {
    const m = manifestOf(skirmish);
    if (typeof m === "string") throw new Error(m);
    expect(fileName(m)).toBe("me.my-skirmish-0.1.0.js");
    const text = prText(m, "ab".repeat(32), "https://example.org/skirmish.js");
    expect(text).toContain(
      "| [My skirmish game](https://example.org/skirmish.js) | 0.1.0 | Me | my-skirmish |",
    );
    expect(text).toContain("ab".repeat(32));
  });
});

describe("module workshop completions", () => {
  const at = (doc: string) => {
    const state = EditorState.create({ doc });
    return sdkCompletions(new CompletionContext(state, doc.length, false));
  };

  it("offers ctx commands and view members after their dot", () => {
    const c = at("yield ctx.ro");
    expect(c?.options).toBe(CTX);
    expect(c?.from).toBe("yield ctx.".length);
    expect(at("ctx.view.dis")?.options).toBe(VIEW);
  });

  it("offers keys and snippets elsewhere, but not after some other object's dot", () => {
    expect(at("  avail")?.options.some((o) => o.label === "available")).toBe(true);
    expect(at("Math.ma")).toBeNull();
  });
});
