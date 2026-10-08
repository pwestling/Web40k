import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  previewAttack,
  resolveIntent,
  type GameState,
  type Model,
} from "../../core";
import { getSystem } from "../../core/content/systems";
import { teach, teachingOf, type Teaching } from "./teach";

const system = getSystem("forty-k-11");

const model = (id: string, owner: string, x: number, sv = "3+"): Model => ({
  id,
  label: id,
  owner,
  position: { x, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { M: '6"', T: "4", SV: sv, W: "3", LD: "6+", OC: "1" } },
  weapons: ["gun"],
});

function setup(): GameState {
  let s = createInitialState();
  s = applyEvent(s, { type: "game/system", system: "forty-k-11" });
  for (const [id, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    s = applyEvent(s, { type: "player/join", player: { id, name: id, color: "#fff", seat } });
  for (const [id, owner, x, ap, sv] of [
    ["shooters", "p1", 0, "-3", "3+"],
    ["targets", "p2", 12, "0", "3+"],
  ] as const)
    s = applyEvent(s, {
      type: "unit/add",
      unit: {
        id,
        owner,
        name: id,
        modelIds: [],
        formation: { kind: "skirmish" },
        sheet: {
          keywords: ["Infantry"],
          abilities: [{ name: "Old Rule", text: "Something the app only reminds you of." }],
          weapons: {
            gun: {
              id: "gun",
              name: "Gun",
              kind: "ranged",
              chars: { RANGE: '24"', A: "2", BS: "3+", S: "4", AP: ap, D: "1" },
              keywords: [],
            },
          },
        },
      },
      models: [model(`${id}1`, owner, x, sv), model(`${id}2`, owner, x + 1.5, sv)],
    });
  return s;
}

function taught(s: GameState, id: string, teaching: Teaching) {
  const auto = teach(teaching, system);
  expect(auto).not.toBeNull();
  const event = resolveIntent(
    { type: "unit/automate", id, ability: "Old Rule", auto },
    s.units[id]!.owner,
    Math.random,
    s,
  );
  return applyEvent(s, event!);
}

const attacks = { kind: "attacks" } as const;
const self = { kind: "self" } as const;

describe("teaching a rule (#53)", () => {
  it("writes the same parts the recognizer reads", () => {
    expect(
      teach(
        {
          when: { kind: "attacks", weapon: "ranged", when: "stationary", against: "Vehicle" },
          who: self,
          what: [
            { kind: "reroll", roll: "hit", which: "ones" },
            { kind: "modify", roll: "wound", by: 1 },
          ],
        },
        system,
      )?.parts,
    ).toEqual([
      {
        kind: "attack",
        side: "making",
        weapon: "ranged",
        against: ["vehicle"],
        when: "stationary",
        roll: "hit",
        reroll: "ones",
      },
      {
        kind: "attack",
        side: "making",
        weapon: "ranged",
        against: ["vehicle"],
        when: "stationary",
        roll: "wound",
        by: 1,
      },
    ]);
    const aura = teach(
      {
        when: attacks,
        who: { kind: "aura", side: "friendly", range: 6, keyword: "Battle Line" },
        what: [
          { kind: "against", roll: "hit", by: -1 },
          { kind: "fnp", x: 5 },
        ],
        oncePerBattle: true,
      },
      system,
    )!;
    expect(aura.aura).toEqual({ range: 6, side: "friendly", keyword: "battle line" });
    expect(aura.oncePerBattle).toBe(true);
    expect(aura.taught).toBe(true);
    expect(
      teach({ when: attacks, who: { kind: "leading" }, what: [{ kind: "stat", stat: "AP", by: 1 }] }, system),
    ).toMatchObject({ whileLeading: true, parts: [{ stat: "AP", by: -1 }] });
  });

  it("starts and ends of phases only gain CP or heal", () => {
    const cp = teach(
      {
        when: { kind: "phase", phase: "command", at: "start" },
        who: self,
        what: [{ kind: "gain", amount: 1 }],
      },
      system,
    )!;
    expect(cp.trigger).toEqual({ phase: "command", at: "start", gain: { resource: "CP", amount: 1 } });
    expect(
      teach(
        { when: { kind: "phase", phase: "command", at: "end" }, who: self, what: [{ kind: "fnp", x: 5 }] },
        system,
      ),
    ).toBeNull();
    expect(teach({ when: attacks, who: self, what: [{ kind: "heal", amount: "D3" }] }, system)).toBeNull();
    expect(teach({ when: attacks, who: self, what: [] }, system)).toBeNull();
  });

  it("reads back for changing", () => {
    const teachings: Teaching[] = [
      {
        when: { kind: "attacks", weapon: "melee", when: "charged" },
        who: { kind: "leading" },
        what: [
          { kind: "reroll", roll: "wound", which: "failed" },
          { kind: "stat", stat: "S", by: 1 },
          { kind: "stat", stat: "D", by: 1 },
        ],
      },
      {
        when: attacks,
        who: self,
        what: [
          { kind: "save", by: 1 },
          { kind: "invuln", x: 4 },
        ],
        oncePerBattle: true,
      },
      {
        when: { kind: "phase", phase: "command", at: "end", anyTurn: true },
        who: self,
        what: [{ kind: "heal", amount: "D3" }],
      },
    ];
    for (const t of teachings) expect(teachingOf(teach(t, system)!)).toEqual(t);
  });

  it("changes the attack at the table: re-rolls, AP, Damage, invulnerable save, Feel No Pain", () => {
    let s = setup();
    const before = previewAttack(s, "shooters", "gun", "targets")!.spec;
    // AP −3 against a 3+ save: 6+.
    expect(before.save).toBe(6);
    s = taught(s, "shooters", {
      when: { kind: "attacks", weapon: "ranged" },
      who: self,
      what: [
        { kind: "reroll", roll: "hit", which: "failed" },
        { kind: "stat", stat: "D", by: 1 },
      ],
    });
    s = taught(s, "targets", {
      when: attacks,
      who: self,
      what: [
        { kind: "invuln", x: 4 },
        { kind: "fnp", x: 5 },
      ],
    });
    const p = previewAttack(s, "shooters", "gun", "targets")!;
    expect(p.spec.rerollHits).toBe("failed");
    expect(p.spec.damage).toBe("2");
    expect(p.spec.save).toBe(4);
    expect(p.spec.fnp).toBe(5);
  });
});
