import { describe, expect, it } from "vitest";
import { cacheName, downloadUrl, indexFolder, scanSave } from "./tts";

const STEAM = "http://cloud-3.steamusercontent.com/ugc/1234567890/ABCDEF0123456789ABCDEF0123456789ABCDEF01/";
const model = (extra: Record<string, unknown>) => ({
  Name: "Custom_Model",
  Transform: { scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 },
  CustomMesh: { MeshURL: STEAM, DiffuseURL: "https://i.imgur.com/abc.png", TypeIndex: 1 },
  ...extra,
});

describe("Tabletop Simulator saves", () => {
  it("finds every custom model, in bags and states, once per mesh, image and size", () => {
    const scan = scanSave({
      SaveName: "Orks vs Marines",
      ObjectStates: [
        model({ Nickname: "Ork Boy" }),
        model({ Nickname: "Ork Boy" }),
        {
          Name: "Bag",
          ContainedObjects: [
            model({ Nickname: "Ork Boy" }),
            model({ Nickname: "Big Boy", Transform: { scaleX: 1, scaleY: 1, scaleZ: 1 } }),
          ],
        },
        model({
          Nickname: "Ruined wall",
          Locked: true,
          CustomMesh: { MeshURL: "https://example.com/models/ruin_a.obj" },
          States: {
            "2": model({ Nickname: "Ork Nob", CustomMesh: { MeshURL: "https://example.com/nob.obj" } }),
          },
        }),
        { Name: "Custom_AssetBundle" },
        { Name: "Card" },
      ],
    });
    expect(scan.title).toBe("Orks vs Marines");
    expect(scan.bundles).toBe(1);
    expect(scan.models.map((m) => [m.name, m.count, m.scale, m.kind])).toEqual([
      ["Big Boy", 1, 1, "miniature"],
      ["Ork Boy", 3, 0.5, "miniature"],
      ["Ork Nob", 1, 0.5, "miniature"],
      ["Ruined wall", 1, 0.5, "terrain"],
    ]);
    expect(() => scanSave({ hello: 1 })).toThrow();
  });

  it("finds TTS's cached copies by the URL, under either Steam host", () => {
    const file = (path: string) => {
      const f = new File(["x"], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    };
    const akamai =
      "https://steamusercontent-a.akamaihd.net/ugc/1234567890/ABCDEF0123456789ABCDEF0123456789ABCDEF01/";
    const folder = indexFolder(
      [
        file(`Tabletop Simulator/Mods/Models/${cacheName(akamai)}.obj`),
        file(`Tabletop Simulator/Mods/Images/${cacheName("https://i.imgur.com/abc.png")}.png`),
        file("Tabletop Simulator/Mods/Workshop/2093745870.json"),
        file("Tabletop Simulator/Mods/Workshop/WorkshopFileInfos.json"),
        file("Tabletop Simulator/Saves/TS_Save_3.json"),
      ],
      [
        [
          {
            Directory:
              "C:\\Users\\me\\Documents\\My Games\\Tabletop Simulator\\Mods\\Workshop\\2093745870.json",
            Name: "40k 10th Edition",
          },
        ],
      ],
    );
    expect(cacheName("https://i.imgur.com/abc.png")).toBe("httpsiimgurcomabcpng");
    expect(folder.find(STEAM, "model")?.name).toBe(`${cacheName(akamai)}.obj`);
    expect(folder.find("https://i.imgur.com/abc.png", "image")).toBeDefined();
    expect(folder.find("https://i.imgur.com/other.png", "image")).toBeUndefined();
    expect(folder.saves.map((s) => s.label)).toEqual(["40k 10th Edition", "TS_Save_3"]);
    expect(downloadUrl(STEAM)).toBe(akamai);
  });
});
