import { describe, expect, it } from "vitest";
import { createInitialState } from "../core";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { spawnIntents } from "../systems/wh40k/deploy";
import { ttsArmies, type TtsAsset } from "./armies";
import { armyMiddle, baseFor, objCentre, placeOnTable, scanTable, turnTable } from "./table";

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
    // Two Boyz mobs far apart on the near (TTS −z, our +y) half, and a Nob with one of them.
    fig("Ork Boy", -10, -15),
    fig("Ork Boy", -9, -15),
    fig("Ork Boy", -8, -15),
    fig("Ork Nob", -7, -15, 0, "https://example.com/nob.obj"),
    fig("Ork Boy", 10, -15),
    fig("Ork Boy", 11, -15),
    // Marines on the far half, facing the Orks.
    fig("Intercessor", 0, 15, 180),
    fig("Intercessor", 1, 15, 180),
    // A ruin, locked in place.
    { ...fig("Ruined wall", 5, 0, 90, "https://example.com/ruin.obj"), Locked: true },
    // A bag of reserves on the far side.
    {
      Name: "Bag",
      Nickname: "Assault Intercessors",
      Transform: { posX: 30, posZ: 20 },
      ContainedObjects: [fig("Assault Intercessor", 0, 0), fig("Assault Intercessor", 0, 0)],
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
      ["Ork Boy", 0, 3, true],
      ["Ork Nob", 0, 1, true],
      ["Ork Boy", 0, 2, true],
      ["Intercessor", 1, 2, true],
      ["Assault Intercessors", 1, 2, false],
    ]);
    // TTS z becomes −y; TTS yaw 180 faces the Marines towards +y (our facing 0).
    const marine = table.units[3]!.models[0]!.pose;
    expect(marine.y).toBe(-15);
    expect(marine.facing).toBeCloseTo(0);
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
    const orks = armies[0]!;
    expect(orks.roster.units[0]!.missing).toContain("M");
    expect(orks.roster.units[0]!.base).toEqual({ shape: "round", diameterMm: 32 });
    expect(orks.figures[1]!["Ork Nob"]!.figure.asset).toBe("https://example.com/nob.obj");

    const state = createInitialState();
    state.players = {
      p1: { id: "p1", name: "A", color: "#c33", seat: 0 },
      p2: { id: "p2", name: "B", color: "#33c", seat: 1 },
    } as unknown as typeof state.players;
    // The Orks stood on seat 0's half: as they were.
    const [first] = spawnIntents(state, "p1", orks.roster.units, "p1-t");
    const boys = first!.type === "unit/add" ? first!.models : [];
    expect(boys.map((m) => [m.position.x, m.position.y])).toEqual([
      [-10, 15],
      [-9, 15],
      [-8, 15],
    ]);
    // The same army deployed by seat 1 turns through the centre onto its own half.
    const [turned] = spawnIntents(state, "p2", orks.roster.units, "p2-t");
    const m = turned!.type === "unit/add" ? turned!.models[0]! : null;
    expect([m!.position.x, m!.position.y]).toEqual([10, -15]);
    expect(m!.facing).toBeCloseTo(2 * Math.PI);
  });

  it("splits armies on the short edges by where they stand, and bags join the army beside them (UX 473, 474)", () => {
    const table = scanTable({
      ObjectStates: [
        fig("Ember Kin", -26, -5),
        fig("Pyre Warden", -24, 6),
        fig("Ork Boy", 25, 0),
        fig("Ork Boy", 26, 1),
        {
          Name: "Bag",
          Nickname: "Reserves",
          Transform: { posX: 28, posZ: 18 },
          ContainedObjects: [fig("Ork Boy", 0, 0)],
        },
      ],
    });
    const sides = Object.fromEntries(table.units.map((u) => [u.name, u.side]));
    expect(sides).toEqual({ "Ember Kin": 0, "Pyre Warden": 0, "Ork Boy": 1, Reserves: 1 });
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
