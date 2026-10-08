import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RulesText } from "./RulesText";

describe("rules text (UX 387)", () => {
  it("shows bold, keywords and bullets instead of their markup", () => {
    const html = renderToStaticMarkup(
      createElement(RulesText, {
        text: "If your army is **^^Iron Warders^^**, pick one: ■ Hold fast. ■ Push on.",
      }),
    );
    expect(html).toBe(
      'If your army is <strong><span class="kw">Iron Warders</span></strong>, pick one:<ul class="rules-bullets"><li>Hold fast.</li><li>Push on.</li></ul>',
    );
    expect(renderToStaticMarkup(createElement(RulesText, { text: "Plain <b>text</b>" }))).toBe(
      "Plain &lt;b&gt;text&lt;/b&gt;",
    );
  });
});
