import { describe, expect, it } from "vitest";
import { createRecord, type GameRecord } from "../core";
import { replayRefs } from "./replayFile";

const h = (c: string) => c.repeat(64);

describe("replayRefs", () => {
  it("finds figures, terrain models and packages anywhere in the log", () => {
    const record: GameRecord = {
      ...createRecord(),
      events: [
        {
          seq: 1,
          event: {
            type: "unit/figure",
            id: "u1",
            keys: ["k"],
            figure: { asset: h("a"), name: "a.glb", yaw: 0, scale: 1 },
          },
        },
        {
          seq: 2,
          event: {
            type: "terrain/add",
            piece: { id: "t", mesh: { asset: h("b"), name: "b.stl", scale: 1 } },
          },
        },
        {
          seq: 3,
          event: { type: "game/packages", packages: [{ id: "p", hash: h("c") }] },
        },
      ] as unknown as GameRecord["events"],
    };
    expect(replayRefs(record)).toEqual({ assets: [h("a"), h("b")], packages: [h("c")] });
  });
});
