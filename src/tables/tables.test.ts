import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, type GameState } from "../core";
import { standardLayout } from "../systems/wh40k/layout";
import { toggleGroup, twinOf, unpaired, useTableEdit } from "./edit";
import { deploymentLine, layoutAssets, readTable, TABLE_FORMAT, tableFromGame } from "./library";
import { sightGrid } from "./Sightlines";
import { starterLayout, starters } from "./starters";

describe("table library", () => {
  it("finds every piece's twin on a point-symmetric table", () => {
    const { terrain } = standardLayout();
    expect(unpaired(terrain)).toEqual([]);
    expect(twinOf(terrain, terrain[0]!)?.id).toBe(terrain[1]!.id);
    const moved = terrain.map((t, i) =>
      i === 0 ? { ...t, position: { x: t.position.x + 3, y: t.position.y } } : t,
    );
    expect(unpaired(moved).length).toBe(2);
  });

  it("generates starter tables that are symmetric, on the table and the same for the same seed", () => {
    for (const system of [undefined, "fsd-1.7", "tow"]) {
      const s = createInitialState();
      const table = system === "fsd-1.7" ? { width: 36, depth: 24 } : s.table;
      for (const { id } of starters()) {
        const a = starterLayout(system, table, id, 3);
        expect(a.terrain.length).toBeGreaterThanOrEqual(2);
        expect(unpaired(a.terrain)).toEqual([]);
        for (const t of a.terrain) {
          expect(Math.abs(t.position.x)).toBeLessThanOrEqual(table.width / 2);
          expect(Math.abs(t.position.y)).toBeLessThanOrEqual(table.depth / 2);
        }
        expect(starterLayout(system, table, id, 3)).toEqual(a);
        expect(starterLayout(system, table, id, 4)).not.toEqual(a);
      }
    }
  });

  it("saves, describes and reads back a table", () => {
    let game: GameState = { ...createInitialState(), ...standardLayout() };
    game = {
      ...game,
      terrain: [{ ...game.terrain[0]!, mesh: { asset: "a".repeat(64), name: "hab.glb", scale: 1 } }],
    };
    const t = tableFromGame(game, "Hab row");
    expect(t.format).toBe(TABLE_FORMAT);
    expect(deploymentLine(t.layout.zones, t.table)).toBe('Long edges (12")');
    expect(layoutAssets(t.layout)).toEqual(["a".repeat(64)]);
    expect(readTable(JSON.parse(JSON.stringify({ ...t, attachments: { assets: {} } })))).toEqual(t);
    expect(readTable({ format: "nope" })).toBeNull();
  });

  it("shows what each zone sees: everything on an open table, less behind a wall", () => {
    const base: GameState = { ...createInitialState(), ...standardLayout(), terrain: [] };
    const open = sightGrid(base);
    expect(open.seats).toEqual([0, 1]);
    expect([...open.seen].every((v) => v === 3)).toBe(true);
    // A tall wall right across the table: neither side sees past it.
    const wall = {
      id: "w",
      name: "Wall",
      category: "solid",
      position: { x: 0, y: 0 },
      width: base.table.width,
      depth: 1,
      facing: 0,
      solids: [{ kind: "block" as const, x: 0, y: 0, z: 0, w: base.table.width, d: 1, h: 10 }],
    };
    const walled = sightGrid({ ...base, terrain: [wall] });
    expect([...walled.seen].some((v) => v === 1)).toBe(true);
    expect([...walled.seen].some((v) => v === 2)).toBe(true);
    expect([...walled.seen].filter((v) => v === 3).length).toBeLessThan(walled.cols * 2);
  });

  it("starts a Shift-click group with the piece already selected", () => {
    useTableEdit.setState({ group: [] });
    toggleGroup("b", "a");
    expect(useTableEdit.getState().group).toEqual(["a", "b"]);
    toggleGroup("c", "b");
    expect(useTableEdit.getState().group).toEqual(["a", "b", "c"]);
    toggleGroup("b", "c");
    expect(useTableEdit.getState().group).toEqual(["a", "c"]);
  });

  it("names the table a layout came from until it's edited", () => {
    const layout = standardLayout();
    let state = applyEvent(createInitialState(), {
      type: "layout/set",
      layout,
      source: { key: "starter:close", name: "Close quarters" },
    });
    expect(state.tableSource).toEqual({ key: "starter:close", name: "Close quarters" });
    state = applyEvent(state, { type: "terrain/remove", id: layout.terrain[0]!.id });
    expect(state.tableSource?.changed).toBe(true);
    state = applyEvent(state, { type: "layout/set", layout });
    expect(state.tableSource).toBeNull();
  });
});
