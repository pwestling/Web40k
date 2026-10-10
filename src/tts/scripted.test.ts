import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { ttsArmies } from "./armies";
import { luaTable } from "./lua";
import { unitFromTts } from "./profiles";
import { scriptUnit } from "./scripted";
import { scanTable } from "./table";

// An invented unit as Yellowscribe's Yellow Machine writes it into a leader model's LuaScript; no published data.
const SCRIPT = ` --[[ UNIT-SPECIFIC DATA ]]--
local unitData = {
    edition = "10e",
    unitName = "Glimmer Wardens",
    unitDecorativeName = "Glimmer Wardens",
    factionKeywords = "Lantern Host",
    keywords = "Infantry, Battleline",
    abilities = {
        { name = [[Sparkstep]], desc = [=[Each time a model in this unit makes a ranged attack, re-roll a Hit roll of 1.]=] },
\t\t{ name = [[Core]], desc = [=[Deep Strike]=] }
    },
    models = {
        { name="Warden Captain", m="6\\"", t="4", sv="3+", w="3", ld="6+", oc="1", insv="5+" },
\t\t{ name="Warden", m="6\\"", t="4", sv="3+", w="2", ld="7+", oc="2" }
    },
    weapons = {
        { name="Glow lance", range=[[18"]], a="2", bsws="3+", s="5", ap="-1", d="2", abilities=[[Lance]], shortabilities=[[Lance]] },
\t\t{ name="Spark carbine", range=[[24"]], a="2", bsws="4+", s="4", ap="0", d="1", abilities=[[Rapid Fire 1]], shortabilities=[[Rapid Fire 1]] },
\t\t{ name="Wardblade", range=[[Melee]], a="3", bsws="3+", s="4", ap="-1", d="1", abilities=[[-]], shortabilities=[[-]] }
    },
    uuid = "84435948",
    uiHeight = 700,
    uiWidth = 1200
}
-- the mod's own script follows
function onLoad() print("hello") end
`;

/** Descriptions as the Yellow Machine writes them: the weapons each model carries. */
const desc = (...weapons: string[]) =>
  `[56f442]M   T   Sv   W   Ld   OC[-]\n6"   4   3+   9   6+   1[-][-]\n\n[e85545]Ranged weapons[-]\n` +
  weapons.map((w) => `[c6c930]${w}[-]\n18" A:2 BS:3+ S:5 AP:-1 D:2 [7bc596]Lance[-]`).join("\n");

const model = (x: number, nickname: string, weapons: string[], script?: string) => ({
  Name: "Custom_Model",
  Nickname: nickname,
  Description: desc(...weapons),
  Tags: ["uuid:84435948", ...(script ? ["leaderModel"] : [])],
  ...(script ? { LuaScript: script } : {}),
  Transform: { posX: x, posY: 1, posZ: -10, rotY: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
  CustomMesh: { MeshURL: "https://example.com/warden.obj", TypeIndex: 1 },
});

describe("Yellowscribe data in TTS scripts (#75)", () => {
  it("reads a Lua table literal: long strings, escapes, nesting, comments and stray commas", () => {
    const t = luaTable(
      `local x = 1\nlocal unitData = { a = "q\\"t", b = [==[long ]] one]==], -- note\n c = { 1, 2.5, true, nil, }, ["d e"] = { k = 'v' },, }`,
      "unitData",
    );
    expect(t).toEqual({ a: 'q"t', b: "long ]] one", c: [1, 2.5, true, null], "d e": { k: "v" } });
    expect(luaTable("local unitData = { a = ", "unitData")).toBeNull();
    expect(luaTable("print(1)", "unitData")).toBeNull();
  });

  it("reads the unit from the leader's script, not its description, and each model's weapons from its description", () => {
    const u = unitFromTts({
      system: DEFAULT_SYSTEM,
      name: "Warden Captain",
      models: [
        { nickname: "[00ff16]3/3[-] Warden Captain", description: desc("Glow lance"), script: SCRIPT },
        { nickname: "[00ff16]2/2[-] Warden", description: desc("2x Spark carbine") },
        { nickname: "[00ff16]2/2[-] Warden", description: "" },
      ],
    })!;
    expect(u.name).toBe("Glimmer Wardens");
    // The description's W 9 loses to the script's profile.
    expect(u.models![0]!.profile).toEqual({
      name: "Warden Captain",
      chars: { M: '6"', T: "4", SV: "3+", W: "3", LD: "6+", OC: "1", INV: "5+" },
    });
    expect(u.models![1]!.profile.chars.W).toBe("2");
    expect(u.models![0]!.weapons).toEqual(["glow-lance-ranged"]);
    expect(u.models![1]!.weapons).toEqual(["spark-carbine-ranged", "spark-carbine-ranged"]);
    // A model with no description carries what one like it does.
    expect(u.models![2]!.weapons).toEqual(["spark-carbine-ranged", "spark-carbine-ranged"]);
    expect(u.sheet!.weapons["wardblade-melee"]!.chars.WS).toBe("3+");
    expect(u.sheet!.keywords).toEqual(["Lantern Host", "Infantry", "Battleline"]);
    // The ability the reader understands comes back automated; the core one stays a reminder.
    const spark = u.sheet!.abilities.find((a) => a.name === "Sparkstep")!;
    expect(spark.auto?.parts[0]).toMatchObject({ kind: "attack", roll: "hit", reroll: "ones" });
    expect(u.sheet!.abilities.find((a) => a.name === "Deep Strike")!.auto).toBeUndefined();
    expect(u.missing).toBeUndefined();
  });

  it("keeps a wound-tracked profile once, at its top bracket", () => {
    const tracked = `local unitData = { unitName = "Gloom Behemoth", keywords = "Monster",
      models = { { name="Gloom Behemoth (8+)", m="10\\"", w="14" }, { name="Gloom Behemoth (1-7)", m="6\\"", w="14" } },
      woundTrack = { ["Gloom Behemoth"] = { ["8+"] = { "10\\"" }, ["1-7"] = { "6\\"" } } },
      weapons = { } }`;
    const u = scriptUnit(tracked)!;
    expect(u.modelProfiles).toEqual([{ name: "Gloom Behemoth", m: '10"', w: "14" }]);
    expect(scriptUnit("local unitData = { }")).toBeNull();
  });

  it("brings a Yellowscribe unit off a TTS table as one unit, whatever its models are called", () => {
    const save = {
      SaveName: "Lantern night",
      ObjectStates: [
        model(-10, "[00ff16]3/3[-] Warden Captain", ["Glow lance"], SCRIPT),
        model(-9, "[00ff16]2/2[-] Warden", ["Spark carbine"]),
        model(-8, "[00ff16]2/2[-] Warden", ["Spark carbine"]),
      ],
    };
    const table = scanTable(save);
    expect(table.units).toHaveLength(1);
    const [army] = ttsArmies(table, new Map(), DEFAULT_SYSTEM, () => "Lantern Host");
    const unit = army!.roster.units[0]!;
    expect(unit.name).toBe("Glimmer Wardens");
    expect(unit.models.map((m) => [m.profile.name, m.weapons])).toEqual([
      ["Warden Captain", ["glow-lance-ranged"]],
      ["Warden", ["spark-carbine-ranged"]],
      ["Warden", ["spark-carbine-ranged"]],
    ]);
    expect(unit.models[0]!.at).toBeDefined();
  });
});
