import { describe, expect, it } from "vitest";
import files from "virtual:sdk-types";
import { createChecker } from "./checker";
import skirmish from "../../../examples/workshop/skirmish.js?raw";
import ranked from "../../../examples/workshop/ranked.js?raw";
import activations from "../../../examples/workshop/activations.js?raw";
import riftLanterns from "../../../games/rift-lanterns/rift-lanterns.js?raw";
import brinewatch from "../../../games/brinewatch/brinewatch.js?raw";

const checker = createChecker(files);

describe("the workshop's type checker (#43)", () => {
  it.each([
    ["skirmish", skirmish],
    ["ranked", ranked],
    ["activations", activations],
    ["Rift Lanterns", riftLanterns],
    ["Brinewatch", brinewatch],
  ])("finds nothing wrong in the %s template", (_name, source) => {
    const problems = checker.problems(source).map((p) => {
      const line = source.slice(0, p.from).split("\n").length;
      return `${line}: ${source.slice(p.from, p.to)} — ${p.message}`;
    });
    expect(problems).toEqual([]);
  });
});

const BROKEN = `export const manifest = { id: "me.x", name: "X", version: "0.1.0", api: 1, kind: "system", systems: ["x"], requires: [] };
const system = {
  id: "x", name: "X", version: "0.1.0", units: "inch",
  dice: [{ id: "d6", sides: 6 }], defaultDie: "d6",
  characteristics: [{ id: "M", name: "Move", of: "modle", type: "distance" }],
  weaponKinds: [], rules: [], procedures: [], actions: [],
  unitShape: { kind: "skirmish" },
  turn: { rounds: 4, rnds: 5, round: [{ kind: "phase", id: "move", name: "Move" }] },
};
export default {
  module: {
    id: "x", version: "0.1.0", api: 1, system,
    actions: [{ id: "a", name: "A", by: "unit", available: () => true,
      *run(ctx, args) { yield ctx.rolll("d6"); } }],
  },
};
`;

describe("a draft with mistakes", () => {
  const problems = checker.problems(BROKEN);
  const at = (text: string) => problems.find((p) => BROKEN.slice(p.from, p.to) === text);

  it("underlines a wrong value where it is written, with the SDK's message", () => {
    expect(at("of")?.message ?? at('"modle"')?.message).toMatch(/modle/);
  });

  it("underlines an unknown key and suggests the right one", () => {
    expect(at("rnds")?.message).toMatch(/^rnds isn't a setting here/);
  });

  it("suggests a key the object doesn't have yet (UX 330: roundz next to round means rounds)", () => {
    const draft = BROKEN.replace("rounds: 4, rnds: 5,", "roundz: 4,");
    const p = checker.problems(draft).find((x) => draft.slice(x.from, x.to) === "roundz");
    expect(p?.message).toBe("roundz isn't a setting here. Did you mean rounds?");
  });

  it("underlines a ctx call the SDK doesn't have", () => {
    expect(at("rolll")?.message).toBe("Ctx has no rolll. Did you mean roll?");
  });

  it("explains ctx on hover and offers its members after a dot", () => {
    const pos = BROKEN.indexOf("ctx.rolll") + 1;
    expect(checker.hover(BROKEN, pos)?.text).toMatch(/ctx: Ctx/);
    const members = checker.complete(BROKEN, BROKEN.indexOf("rolll")).map((c) => c.label);
    expect(members).toContain("roll");
    expect(members).toContain("view");
  });
});

describe("helpers outside the module", () => {
  const HELPER = `function* strike(ctx, args) {
  yield ctx.emit({ type: "model/wonuds", id: args.id });
  return ctx.view.distnce(args.a, args.b);
}
const near = (view, a) => view.units[a];
`;

  it("take ctx and view from the SDK's names, so wrong events and calls are underlined", () => {
    const found = checker.problems(HELPER).map((p) => HELPER.slice(p.from, p.to));
    expect(found).toContain("distnce");
    expect(found.some((f) => f === "type" || f.includes("wonuds"))).toBe(true);
    expect(checker.hover(HELPER, HELPER.indexOf("view, a") + 1)?.text).toMatch(/view: GameView/);
  });
});
