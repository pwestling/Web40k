import { describe, expect, it } from "vitest";
import { fortyK } from "../core/content/examples/forty-k";
import type { Ability, Army } from "../core/types";
import { ENHANCEMENTS, type ImportedRoster } from "../systems/wh40k/roster";
import { SandboxEngine } from "../sandbox/engine";
import cinderCourt from "../../examples/faction-packs/cinder-court.js?raw";
import { packAutomated, packMismatches, packName, readFactionPack } from "./faction";
import { useLibrary } from "./library";
import { sha256 } from "./manifest";
import { acceptPack, declinePack, fetchPack, pinnedFor, rawLink, usePins, withPinnedPacks } from "./packPins";
import { readArmy, ARMY_FORMAT } from "./shelf";

// Faction packs by URL (#76). Every name below is invented: the Ashen Host is one of the app's own
// sample armies, and the example pack's detachment, enhancements and stratagems were made up for it.

const URL_ = "https://packs.example/cinder-court.js";
const bytes = (s: string) => new TextEncoder().encode(s);
/** A fetch that serves whatever `served` holds now. */
function server(served: { text: string }) {
  return async (url: string) => {
    if (url !== URL_) return new Response("no", { status: 404 });
    return new Response(bytes(served.text));
  };
}

const unit = (name: string, abilities: Ability[]): ImportedRoster["units"][number] => ({
  name,
  sheet: { weapons: {}, abilities, keywords: ["Infantry"] },
  models: [{ profile: { name, chars: { M: '6"', T: "4", SV: "4+", W: "2" } }, weapons: [] }],
  base: { shape: "round", diameterMm: 32 },
});

/** An Ashen Host list in the Cinder Court, names written the way exports vary them. */
function roster(): ImportedRoster {
  const army: Army = {
    faction: "Ashen Host",
    detachment: "CINDER COURT",
    rules: [{ name: "Embers rise", text: "The player's own text.", group: "Detachment rule" }],
    stratagems: [
      {
        id: "choking-ash",
        name: "Choking Ash (1CP)",
        cp: 1,
        side: "either",
        targetsUnit: true,
        text: "The player's own text.",
      },
    ],
  };
  return {
    name: "Test Host",
    units: [
      unit("Thralls", [
        { name: "ENDLESS TIDE", text: "" },
        { name: "Stubborn Ash", text: "Not in the pack." },
      ]),
      unit("Colossus", [
        { name: "Searing-Grip", text: "" },
        { name: "Burning Bulk", text: "" },
      ]),
      unit("Speaker", [{ name: "coal heart sigil", text: "", group: ENHANCEMENTS }]),
    ],
    army,
    warnings: [],
  };
}

describe("faction packs (#76)", () => {
  it("reads the example pack as data, without running it", () => {
    const read = readFactionPack(cinderCourt);
    if ("error" in read) throw new Error(read.error);
    expect(read.manifest).toMatchObject({ kind: "faction", systems: ["forty-k"] });
    expect(read.code).toBe(true);
    expect(read.pack.detachments?.[0]?.stratagems?.map((s) => s.name)).toEqual([
      "Banked Embers",
      "Choking Ash",
      "Kiln-Hardened",
      "Drifting Cinders",
    ]);
    // Not a faction pack, or data that isn't a literal: refused before anything runs.
    expect(readFactionPack(cinderCourt.replace('kind: "faction"', 'kind: "extension"'))).toHaveProperty(
      "error",
    );
    expect(readFactionPack(cinderCourt.replace("cp: 2,", "cp: two,"))).toHaveProperty("error");
    expect(readFactionPack(cinderCourt.replace('side: "inactive"', 'side: "theirs"'))).toMatchObject({
      error: expect.stringContaining("side"),
    });
  });

  it("matches names whatever their case, punctuation or cost", () => {
    expect(packName("Coal-Heart Sigil")).toBe(packName("coal heart sigil"));
    expect(packName("Choking Ash (1CP)")).toBe(packName("CHOKING ASH"));
    expect(packName("Choking Ash (2 cp)")).toBe("choking ash");
    expect(packName("Kiln’s Gift")).toBe(packName("Kilns Gift"));
    expect(packName("Ásh  Veil!")).toBe("ash veil");
    expect(packName("Embers Rise")).not.toBe(packName("Embers Rising"));
  });

  it("loads a pack from a link: hash, consent, pin, then applies it to a matching army and counts it", async () => {
    const served = { text: cinderCourt };
    const offer = await fetchPack(URL_, server(served));
    if ("error" in offer) throw new Error(offer.error);
    // What the consent sheet shows: the pack, its hash, that it's new and has code.
    expect(offer.pkg.hash).toBe(await sha256(bytes(cinderCourt)));
    expect(offer).toMatchObject({ status: "new", ask: true, fresh: true, code: true });
    expect(useLibrary.getState().packages[offer.pkg.hash]?.trusted).toBe(false);
    // Nothing applies before the player says yes.
    expect(pinnedFor("forty-k-11")).toEqual([]);
    expect(withPinnedPacks(roster(), "forty-k-11", fortyK)).toEqual(roster());

    const pin = acceptPack(offer);
    expect(pin).toMatchObject({ url: URL_, hash: offer.pkg.hash, id: "example.cinder-court", code: true });
    expect(useLibrary.getState().packages[offer.pkg.hash]?.trusted).toBe(true);
    expect(usePins.getState().pins[URL_]?.hash).toBe(offer.pkg.hash);
    // Another game's armies don't get it.
    expect(pinnedFor("tow")).toEqual([]);

    const r = withPinnedPacks(roster(), "forty-k-11", fortyK);
    const abilities = r.units.flatMap((u) => u.sheet.abilities);
    const auto = (name: string) => abilities.find((a) => a.name === name)?.auto;
    // Unit abilities by name: a taught heal, #38 parts compiled, code-played, and an enhancement's effects.
    expect(auto("ENDLESS TIDE")).toMatchObject({
      pack: "Cinder Court (example)",
      trigger: { phase: "command", at: "start", heal: "1", revive: true },
    });
    expect(auto("ENDLESS TIDE")?.taught).toBeUndefined();
    expect(auto("Searing-Grip")?.effects.length).toBeGreaterThan(0);
    expect(auto("Burning Bulk")).toEqual({ parts: [], effects: [], pack: "Cinder Court (example)" });
    expect(auto("coal heart sigil")?.effects[0]?.do[0]).toEqual({ do: "ignoreDamage", atLeast: 5 });
    expect(auto("Stubborn Ash")).toBeUndefined();
    // The detachment: its rule automated, the faction's rule added, the listed stratagem set from the
    // pack (cost, side, phases) and the others added.
    const army = r.army!;
    expect(army.rules.map((x) => [x.name, x.auto?.pack, x.group])).toEqual([
      ["Embers rise", "Cinder Court (example)", "Detachment rule"],
      ["Ashen Resolve", "Cinder Court (example)", "Army rule"],
    ]);
    expect(army.rules[0]!.text).toBe("The player's own text.");
    const choking = army.stratagems.find((s) => s.id === "choking-ash")!;
    expect(choking).toMatchObject({ cp: 1, side: "inactive", phases: ["shooting"], targetsUnit: true });
    expect(choking.auto?.parts).toEqual([{ kind: "attack", side: "targeted", roll: "hit", by: -1 }]);
    expect(army.stratagems.map((s) => [s.name, s.cp, s.pack, !!s.auto])).toEqual([
      ["Choking Ash (1CP)", 1, undefined, true],
      ["Banked Embers", 1, "Cinder Court (example)", true],
      ["Kiln-Hardened", 2, "Cinder Court (example)", true],
      ["Drifting Cinders", 1, "Cinder Court (example)", false],
    ]);
    expect(army.stratagems.find((s) => s.name === "Banked Embers")).toMatchObject({ notYet: "shot" });
    expect(army.stratagems.find((s) => s.name === "Kiln-Hardened")).toMatchObject({
      targetKeywords: "Infantry",
    });
    expect(army.stratagems.find((s) => s.name === "Drifting Cinders")?.targetsUnit).toBeUndefined();
    // The army names the pack it was made with, by hash and link.
    expect(army.packs).toEqual([
      {
        id: "example.cinder-court",
        name: "Cinder Court (example)",
        version: "1.0.0",
        hash: offer.pkg.hash,
        bytes: offer.pkg.bytes,
        url: URL_,
        code: true,
      },
    ]);
    // The import's coverage lines count what the pack plays: 3 unit abilities; for the detachment,
    // 2 rules, 1 enhancement and 3 stratagems.
    expect(packAutomated(r)).toEqual({ units: 3, army: 6 });
    // Applying it again (a newer version, or a shelf army) replaces its rules rather than doubling them.
    const again = withPinnedPacks(r, "forty-k-11", fortyK);
    expect(again.army!.stratagems).toHaveLength(4);
    expect(again.army!.packs).toHaveLength(1);
    // A player's own taught rule stays theirs.
    const taught = roster();
    taught.units[0]!.sheet.abilities[0] = {
      name: "ENDLESS TIDE",
      text: "",
      auto: { parts: [{ kind: "fnp", x: 6 }], effects: [], taught: true },
    };
    expect(withPinnedPacks(taught, "forty-k-11", fortyK).units[0]!.sheet.abilities[0]!.auto?.taught).toBe(
      true,
    );
    // An army of another faction and detachment: only the matching names change, and none here.
    const other: ImportedRoster = {
      name: "Other",
      units: [unit("Ranks", [{ name: "Hold Fast", text: "" }])],
      warnings: [],
    };
    expect(withPinnedPacks(other, "forty-k-11", fortyK)).toEqual(other);

    // The pack travels with the army in a shelf file.
    const file = readArmy(
      JSON.parse(
        JSON.stringify({
          format: ARMY_FORMAT,
          id: "a",
          name: "Test Host",
          system: "forty-k-11",
          savedAt: 1,
          roster: r,
          figures: {},
        }),
      ),
    );
    expect(file?.roster.army?.packs?.[0]?.hash).toBe(offer.pkg.hash);

    // The same bytes again: no question.
    const same = await fetchPack(URL_, server(served));
    expect(same).toMatchObject({ status: "same", ask: false, fresh: false });
  });

  it("asks again when the bytes at a pinned link change, and keeps the old pin on a no", async () => {
    const served = { text: cinderCourt };
    const first = await fetchPack(URL_, server(served));
    if ("error" in first) throw new Error(first.error);
    acceptPack(first);
    served.text = cinderCourt.replace('version: "1.0.0"', 'version: "1.0.1"');
    const changed = await fetchPack(URL_, server(served));
    if ("error" in changed) throw new Error(changed.error);
    expect(changed).toMatchObject({ status: "changed", was: first.pkg.hash, ask: true, fresh: true });
    expect(changed.pkg.hash).not.toBe(first.pkg.hash);
    declinePack(changed);
    expect(useLibrary.getState().packages[changed.pkg.hash]).toBeUndefined();
    expect(usePins.getState().pins[URL_]?.hash).toBe(first.pkg.hash);
    // A yes this time pins the new bytes.
    const again = await fetchPack(URL_, server(served));
    if ("error" in again) throw new Error(again.error);
    expect(again.ask).toBe(true);
    acceptPack(again);
    expect(usePins.getState().pins[URL_]).toMatchObject({ hash: again.pkg.hash, version: "1.0.1" });
    expect(pinnedFor("forty-k-11").map((p) => p.pin.version)).toEqual(["1.0.1"]);
  });

  it("refuses links that aren't https, answer an error or hold no faction pack", async () => {
    expect(await fetchPack("http://packs.example/x.js", server({ text: "" }))).toHaveProperty("error");
    expect(await fetchPack("https://packs.example/missing.js", server({ text: "" }))).toMatchObject({
      error: expect.stringContaining("404"),
    });
    const before = Object.keys(useLibrary.getState().packages).length;
    const plain =
      "export const manifest = { id: 'x', name: 'X', version: '1', api: 1, kind: 'extension', systems: [] };";
    expect(await fetchPack(URL_, server({ text: plain }))).toHaveProperty("error");
    expect(Object.keys(useLibrary.getState().packages)).toHaveLength(before);
    expect(rawLink("https://github.com/someone/packs/blob/main/a.js")).toBe(
      "https://raw.githubusercontent.com/someone/packs/main/a.js",
    );
  });

  it("flags a table whose armies were made with other bytes of a pack", () => {
    const ref = (hash: string) => ({
      id: "example.cinder-court",
      name: "Cinder Court",
      version: "1",
      hash,
      bytes: 1,
    });
    const armies: Record<string, Army> = {
      p1: { rules: [], stratagems: [], packs: [ref("aaaa")] },
      p2: { rules: [], stratagems: [], packs: [ref("bbbb")] },
    };
    expect(packMismatches(armies, [])).toEqual([{ player: "p2", pack: ref("bbbb"), other: "aaaa" }]);
    expect(packMismatches(armies, [{ id: "example.cinder-court", hash: "aaaa" }])).toEqual([
      { player: "p2", pack: ref("bbbb"), other: "aaaa" },
    ]);
    expect(packMismatches({ p1: armies.p1 }, [{ id: "example.cinder-court", hash: "aaaa" }])).toEqual([]);
  });

  it("loads the pack's code in the sandbox, and its charge hook plays Burning Bulk", async () => {
    const importSource = (source: string) =>
      import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
        default?: unknown;
      }>;
    const loaded = await new SandboxEngine(importSource).load([{ hash: "cc", source: cinderCourt }]);
    expect(loaded.errors).toEqual([]);
    expect(loaded.packages[0]).toMatchObject({ systems: ["forty-k-11"] });
    expect(Object.keys(loaded.packages[0]!.hooks)).toEqual(["charge"]);

    // The hook itself, driven as the host's runner drives it: a 5 wounds the engaged enemy.
    const mod = (await importSource(cinderCourt)) as {
      default: { hooks: { charge: (ctx: unknown, args: unknown) => Generator<unknown, void, unknown> } };
    };
    const state = {
      units: {
        big: {
          id: "big",
          name: "Colossus",
          modelIds: ["b1"],
          sheet: { abilities: [{ name: "Burning Bulk" }] },
        },
        foe: { id: "foe", name: "Foes", modelIds: ["f1"] },
      },
      models: { f1: { id: "f1", profile: { chars: { W: "1" } } } },
    };
    const ctx = {
      view: { state, engaged: () => ["foe"] },
      note: (text: string) => ({ cmd: "note", text }),
      roll: (dice: string) => ({ cmd: "roll", dice }),
      emit: (event: unknown) => ({ cmd: "emit", event }),
    };
    const gen = mod.default.hooks.charge(ctx, { kind: "move", landed: true, unitId: "big" });
    const cmds: unknown[] = [];
    let next = gen.next();
    while (!next.done) {
      cmds.push(next.value);
      next = gen.next((next.value as { cmd: string }).cmd === "roll" ? { total: 5, rolls: [5] } : undefined);
    }
    expect(cmds).toContainEqual({
      cmd: "emit",
      event: { type: "model/wounds", id: "f1", woundsLost: 1, destroyed: true },
    });
  });
});
