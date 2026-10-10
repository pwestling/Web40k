import { describe, expect, it } from "vitest";
import { createInitialState } from "../core";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { spawnIntents } from "../systems/wh40k/deploy";
import { ttsArmies, type TtsAsset } from "./armies";
import { armyMiddle, bakeObj, bakeOf, baseFor, objCentre, placeOnTable, scanTable, turnTable } from "./table";

const fig = (nickname: string, x: number, z: number, rotY = 0, mesh = "https://example.com/boy.obj") => ({
  Name: "Custom_Model",
  Nickname: nickname,
  Description: "[b]M[/b] 6 T 5",
  Transform: { posX: x, posY: 1, posZ: z, rotY, scaleX: 1, scaleY: 1, scaleZ: 1 },
  CustomMesh: { MeshURL: mesh, TypeIndex: 1 },
});

const SAVE = {
  SaveName: "Kill Team night",
  ObjectStates: [
    // Two Brutes mobs far apart on the near (TTS −z, our +y) half, and a Boss with one of them.
    fig("Scrap Brute", -10, -15),
    fig("Scrap Brute", -9, -15),
    fig("Scrap Brute", -8, -15),
    fig("Scrap Boss", -7, -15, 0, "https://example.com/boss.obj"),
    fig("Scrap Brute", 10, -15),
    fig("Scrap Brute", 11, -15),
    // Wardens on the far half, facing the Scrappers.
    fig("Warden", 0, 15, 180),
    fig("Warden", 1, 15, 180),
    // A ruin, locked in place.
    { ...fig("Ruined wall", 5, 0, 90, "https://example.com/ruin.obj"), Locked: true },
    // A bag of reserves on the far side.
    {
      Name: "Bag",
      Nickname: "Assault Wardens",
      Transform: { posX: 30, posZ: 20 },
      ContainedObjects: [fig("Assault Warden", 0, 0), fig("Assault Warden", 0, 0)],
    },
  ],
};

describe("a whole TTS table (#73)", () => {
  it("reads terrain, units by name and place, and bags as units not deployed yet", () => {
    const table = scanTable(SAVE);
    expect(table.title).toBe("Kill Team night");
    expect(table.terrain.map((t) => [t.nickname, t.pose.x, t.pose.y])).toEqual([["Ruined wall", 5, 0]]);
    const units = table.units.map((u) => [u.name, u.side, u.models.length, u.placed]);
    expect(units).toEqual([
      ["Scrap Brute", 0, 3, true],
      ["Scrap Boss", 0, 1, true],
      ["Scrap Brute", 0, 2, true],
      ["Warden", 1, 2, true],
      ["Assault Wardens", 1, 2, false],
    ]);
    // TTS z becomes −y; TTS yaw 180 faces the Wardens towards +y (our facing 0).
    const warden = table.units[3]!.models[0]!.pose;
    expect(warden.y).toBe(-15);
    expect(warden.facing).toBeCloseTo(0);
    expect(table.units[0]!.models[0]!.pose.facing).toBeCloseTo(Math.PI);
  });

  it("puts a mesh whose footprint isn't on its pivot where TTS drew it", () => {
    // A wall drawn 2" along the file's +x of its pivot, the object turned so its +x points towards +y.
    const at = placeOnTable({ x: 0, y: 0, facing: -Math.PI / 2 }, [2, 0, 0], 1);
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(2);
    expect(objCentre("v 1 0 -1\nv 3 2 1\nvt 0 0\nv 2 -1 0\n")).toEqual([2, -1, 0]);
    expect(baseFor(1.26, 1.3)).toEqual({ shape: "round", diameterMm: 32 });
    expect(baseFor(2.4, 4.3).shape).toBe("oval");
  });

  it("becomes shelf armies whose models deploy where they stood, on the deploying side", () => {
    const table = scanTable(SAVE);
    const asset = (id: string): TtsAsset => ({
      id,
      name: id,
      width: 1.26,
      depth: 1.26,
      height: 1.6,
      centre: [0, 0, 0],
    });
    const assets = new Map(
      [...new Set(table.units.flatMap((u) => u.models.map((m) => m.key)))].map((k) => [
        k,
        asset(k.split("|")[0]!),
      ]),
    );
    const armies = ttsArmies(table, assets, DEFAULT_SYSTEM, (side) => `Side ${side}`);
    expect(armies.map((a) => [a.side, a.roster.units.length])).toEqual([
      [0, 3],
      [1, 2],
    ]);
    const scrappers = armies[0]!;
    expect(scrappers.roster.units[0]!.missing).toContain("M");
    expect(scrappers.roster.units[0]!.base).toEqual({ shape: "round", diameterMm: 32 });
    expect(scrappers.figures[1]!["Scrap Boss"]!.figure.asset).toBe("https://example.com/boss.obj");

    const state = createInitialState();
    state.players = {
      p1: { id: "p1", name: "A", color: "#c33", seat: 0 },
      p2: { id: "p2", name: "B", color: "#33c", seat: 1 },
    } as unknown as typeof state.players;
    // The Scrappers stood on seat 0's half: as they were.
    const [first] = spawnIntents(state, "p1", scrappers.roster.units, "p1-t");
    const boys = first!.type === "unit/add" ? first!.models : [];
    expect(boys.map((m) => [m.position.x, m.position.y])).toEqual([
      [-10, 15],
      [-9, 15],
      [-8, 15],
    ]);
    // The same army deployed by seat 1 turns through the centre onto its own half.
    const [turned] = spawnIntents(state, "p2", scrappers.roster.units, "p2-t");
    const m = turned!.type === "unit/add" ? turned!.models[0]! : null;
    expect([m!.position.x, m!.position.y]).toEqual([10, -15]);
    expect(m!.facing).toBeCloseTo(2 * Math.PI);
    // A table opened as a game keeps every place, whichever seat (UX 477).
    const [kept] = spawnIntents(state, "p2", scrappers.roster.units, "p2-k", undefined, true);
    const k = kept!.type === "unit/add" ? kept!.models[0]! : null;
    expect([k!.position.x, k!.position.y]).toEqual([-10, 15]);
  });

  it("splits armies on the short edges by where they stand, and bags join the army beside them (UX 473, 474)", () => {
    const table = scanTable({
      ObjectStates: [
        fig("Ember Kin", -26, -5),
        fig("Pyre Warden", -24, 6),
        fig("Scrap Brute", 25, 0),
        fig("Scrap Brute", 26, 1),
        {
          Name: "Bag",
          Nickname: "Reserves",
          Transform: { posX: 28, posZ: 18 },
          ContainedObjects: [fig("Scrap Brute", 0, 0)],
        },
      ],
    });
    const sides = Object.fromEntries(table.units.map((u) => [u.name, u.side]));
    expect(sides).toEqual({ "Ember Kin": 0, "Pyre Warden": 0, "Scrap Brute": 1, Reserves: 1 });
    // Turning the table turns the bag with it, and nobody changes army.
    const turned = turnTable(table, Math.PI / 2);
    expect(turned.units.map((u) => u.side)).toEqual(table.units.map((u) => u.side));
    const bag = turned.units.find((u) => !u.placed)!.bag!;
    expect([bag.x, bag.y]).toEqual([18, 28]);
    expect(armyMiddle(turned, 1)!.y).toBeGreaterThan(20);
  });

  it("keeps a figure whose files never came as a stand-in (UX 475)", () => {
    const table = scanTable({
      ObjectStates: [fig("Broken Thing", 0, -10, 0, "https://example.com/gone.obj")],
    });
    const [army] = ttsArmies(table, new Map(), DEFAULT_SYSTEM, () => "A");
    const model = army!.roster.units[0]!.models[0]!;
    expect(model.base).toEqual({ shape: "round", diameterMm: 32 });
    expect([model.at!.x, model.at!.y]).toEqual([0, 10]);
    expect(army!.figures[0]).toEqual({});
  });
});

describe("tilted and stretched terrain from TTS", () => {
  const obj = (rot: { rotX?: number; rotZ?: number }, scale = [1, 1, 1]) => ({
    Name: "Custom_Model",
    Nickname: "Plank",
    Locked: true,
    Transform: { posX: 0, posZ: 0, rotY: 0, ...rot, scaleX: scale[0], scaleY: scale[1], scaleZ: scale[2] },
    CustomMesh: { MeshURL: "https://example.com/plank.obj", TypeIndex: 1 },
  });
  const apply = (m: number[], v: [number, number, number]) =>
    [0, 1, 2].map((i) => +(m[i * 3]! * v[0] + m[i * 3 + 1]! * v[1] + m[i * 3 + 2]! * v[2]).toFixed(3));

  it("leaves upright, evenly scaled pieces alone (TTS's rounding noise too)", () => {
    expect(bakeOf(obj({ rotX: 359.6, rotZ: 0.3 }), 1)).toBeUndefined();
    expect(bakeOf(obj({}, [2, 2, 2]), 2)).toBeUndefined();
  });

  it("stands a plank tipped on its end upright, as TTS shows it", () => {
    // Tipped 90° about x: the OBJ's length along z now points up (or down: the pipeline stands it on the table).
    const m = bakeOf(obj({ rotX: 90 }), 1)!;
    expect(Math.abs(apply(m, [0, 0, 3])[1]!)).toBeCloseTo(3);
    expect(apply(m, [1, 0, 0])).toEqual([1, 0, 0]);
    const baked = bakeObj("v 0 0 3\nv 1 0 0\nf 1 2 1\n", m).split("\n");
    expect(baked[0]).toMatch(/^v 0 -?3 0$/);
    expect(baked[2]).toBe("f 1 2 1");
  });

  it("tilts about z against the OBJ's mirrored x, and keeps uneven stretch", () => {
    // TTS's x is the OBJ's −x, so a turn raising TTS's +x lowers the OBJ's +x.
    const m = bakeOf(obj({ rotZ: 30 }), 1)!;
    expect(apply(m, [1, 0, 0])).toEqual([0.866, -0.5, 0]);
    const s = bakeOf(obj({}, [2, 1, 1]), 4 / 3)!;
    expect(apply(s, [1, 1, 1])).toEqual([1.5, 0.75, 0.75]);
  });

  it("makes a tilted copy of a piece its own model", () => {
    const table = scanTable({ ObjectStates: [obj({}), obj({ rotX: 30 })] });
    expect(table.terrain).toHaveLength(2);
    expect(table.terrain[0]!.key).not.toBe(table.terrain[1]!.key);
    expect(table.terrain[1]!.bake).toHaveLength(9);
  });
});

describe("what a TTS veteran laid out on purpose (PX TTS 3)", () => {
  it("puts a sergeant back in the squad it stands in, but leaves a leader to lead by choice", () => {
    const table = scanTable({
      ObjectStates: [
        fig("Warden Sergeant", -6, -15),
        ...[0, 1, 2, 3].map((i) => fig("Warden", -5 + i, -15)),
        { ...fig("Warden Captain", -4, -14), Description: "Abilities: Leader" },
        // A sergeant of another squad far away stays apart.
        fig("Warden Sergeant", 20, -15),
        fig("Warden", 0, 15, 180),
      ],
    });
    const names = table.units.map((u) => `${u.name} ${u.models.length}`).sort();
    expect(names).toEqual(["Warden 1", "Warden 5", "Warden Captain 1", "Warden Sergeant 1"]);
    expect(table.units.find((u) => u.name === "Warden")!.models[0]!.nickname).toBe("Warden Sergeant");
  });

  it("names the asset bundles it can't bring", () => {
    const table = scanTable({
      ObjectStates: [
        fig("Scrap Brute", 0, -15),
        { Name: "Custom_AssetBundle", Nickname: "Objective marker" },
      ],
    });
    expect(table.bundles).toEqual(["Objective marker"]);
  });

  it("sends a unit still in its bag into reserves", async () => {
    const save = scanTable(SAVE);
    const assets = new Map<string, TtsAsset>();
    const [, wardens] = ttsArmies(save, assets, DEFAULT_SYSTEM, () => "army");
    const bagged = wardens!.roster.units.find((u) => u.name === "Assault Wardens")!;
    expect(bagged.reserve).toBe(true);
    const state = createInitialState();
    state.players = {
      p2: { id: "p2", name: "B", color: "#33c", seat: 1 },
    } as unknown as typeof state.players;
    const intents = spawnIntents(state, "p2", [bagged], "p2-r");
    expect(intents.map((i) => i.type)).toEqual(["unit/add", "unit/reserve"]);
  });
});
