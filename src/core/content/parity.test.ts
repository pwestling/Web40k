import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  rollStage,
  startAttack,
  type AttackSpec,
  type AttackState,
  type GameState,
  type Model,
  type UnitSheet,
} from "../index";
import { makePiece } from "../../systems/wh40k/layout";
import { suggestAttack } from "../../systems/wh40k/rules";
import { legacyRollStage, legacyStartAttack, legacySuggestAttack } from "./testing/legacy40k";
import { averageSum, parseDiceSum } from "./runtime";

/**
 * Parity between the data-driven attack (procedure runner over the 40k
 * GameSystem) and the hand-written one it replaced. Same rng, same dice,
 * same results, over many random attacks.
 */

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickFrom = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

const model = (
  id: string,
  owner: string,
  x: number,
  y: number,
  chars: Record<string, string>,
  weapons: string[] = [],
): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars },
  weapons,
});

function targetTable(rng: () => number): GameState {
  const W = pickFrom(rng, ["1", "2", "3", "6"]);
  const count = 1 + Math.floor(rng() * 6);
  let s = applyEvent(createInitialState(), {
    type: "unit/add",
    unit: { id: "t", owner: "p2", name: "Targets", modelIds: [], formation: { kind: "skirmish" } },
    models: Array.from({ length: count }, (_, i) => model(`t${i}`, "p2", i * 2, 10, { T: "4", SV: "3+", W })),
  });
  // Some models already wounded, not necessarily the first.
  for (let i = 0; i < count; i++)
    if (Number(W) > 1 && rng() < 0.3)
      s = applyEvent(s, { type: "model/wounds", id: `t${i}`, woundsLost: Number(W) - 1, destroyed: false });
  return s;
}

function randomSpec(rng: () => number): AttackSpec {
  return {
    attackerUnitId: "a",
    targetUnitId: "t",
    weaponId: "w",
    weaponName: "W",
    kind: "ranged",
    attacks: pickFrom(rng, ["1", "4", "10", "D6", "2D6", "D3+3", "3D6+3"]),
    hit: pickFrom(rng, [null, 2, 3, 4, 5, 6]),
    hitMod: pickFrom(rng, [-2, -1, 0, 0, 1, 2]),
    critHit: pickFrom(rng, [5, 6, 6]),
    rerollHits: pickFrom(rng, ["none", "ones", "failed"] as const),
    sustained: pickFrom(rng, [0, 0, 1, 2]),
    lethal: rng() < 0.3,
    wound: pickFrom(rng, [2, 3, 4, 5, 6]),
    woundMod: pickFrom(rng, [-1, 0, 1]),
    critWound: pickFrom(rng, [4, 5, 6, 6]),
    rerollWounds: pickFrom(rng, ["none", "ones", "failed"] as const),
    devastating: rng() < 0.3,
    save: pickFrom(rng, [null, 2, 3, 4, 5, 6]),
    damage: pickFrom(rng, ["1", "2", "D3", "D6", "D6+1", "3"]),
    fnp: pickFrom(rng, [null, null, 5, 6]),
  };
}

/** The fields the attack panel reads; the new state also carries its run. */
function visible(a: AttackState) {
  const { run: _run, ...rest } = a;
  return rest;
}

describe("attack execution parity with the hand-written sequence", () => {
  it("rolls the same dice to the same results over 2000 random attacks", () => {
    const pick = mulberry(42);
    for (let i = 0; i < 2000; i++) {
      const state = targetTable(pick);
      const spec = randomSpec(pick);
      const seed = Math.floor(pick() * 1e9);
      const oldRng = mulberry(seed);
      const newRng = mulberry(seed);
      let before = legacyStartAttack(spec, oldRng);
      let after = startAttack(spec, newRng, state);
      expect(visible(after), `attack ${i} declare ${JSON.stringify(spec)}`).toEqual(before);
      while (before.stage !== "done") {
        before = legacyRollStage(state, before, oldRng);
        after = rollStage(state, after, newRng);
        expect(visible(after), `attack ${i} ${before.stage} ${JSON.stringify(spec)}`).toEqual(before);
      }
      expect(after.stage).toBe("done");
    }
  });
});

// ---------------------------------------------------------------------------
// Suggestions: the numbers the panel proposes before players edit them
// ---------------------------------------------------------------------------

const KEYWORDS = [
  "Rapid Fire 1",
  "Rapid Fire 2",
  "Sustained Hits 1",
  "Sustained Hits 2",
  "Lethal Hits",
  "Devastating Wounds",
  "Anti-Infantry 4+",
  "Anti-Vehicle 2+",
  "Heavy",
  "Lance",
  "Twin-linked",
  "Torrent",
  "Blast",
  "Melta 2",
  "Ignores Cover",
  "Precision",
  "Hazardous",
  "Pistol",
];

function randomTable(rng: () => number): GameState {
  const kind = rng() < 0.75 ? "ranged" : "melee";
  // Ranged-only keywords stay off melee weapons, as in real data.
  const keywords = KEYWORDS.filter(
    (k) => rng() < 0.15 && !(kind === "melee" && /rapid|melta|blast|torrent|heavy|pistol|indirect/i.test(k)),
  ).filter(
    (k, i, all) => !all.slice(0, i).some((x) => !/^anti/i.test(k) && x.split(" ")[0] === k.split(" ")[0]),
  );
  const chars: Record<string, string> =
    kind === "ranged"
      ? {
          RANGE: pickFrom(rng, ['12"', '18"', '24"', '36"']),
          A: pickFrom(rng, ["1", "2", "D3", "D6", "D6+1"]),
          BS: pickFrom(rng, ["2+", "3+", "4+", "5+"]),
          S: pickFrom(rng, ["3", "4", "5", "8", "10"]),
          AP: pickFrom(rng, ["0", "-1", "-2", "-4"]),
          D: pickFrom(rng, ["1", "2", "D3", "D6", "D6+2"]),
        }
      : {
          RANGE: "Melee",
          A: pickFrom(rng, ["2", "3", "D6"]),
          WS: pickFrom(rng, ["2+", "3+", "4+"]),
          S: pickFrom(rng, ["4", "6", "8"]),
          AP: pickFrom(rng, ["0", "-1", "-2"]),
          D: pickFrom(rng, ["1", "2", "D3"]),
        };
  const shooters = 1 + Math.floor(rng() * 5);
  const near = kind === "melee" ? 1.5 : 4;
  const attacker: UnitSheet = {
    weapons: { w: { id: "w", name: "W", kind, chars, keywords } },
    abilities: [],
    keywords: ["Infantry"],
  };
  let s = createInitialState();
  s = { ...s, settings: { ...s.settings, cover: rng() < 0.5 ? "hit" : "save" } };
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "a",
      owner: "p1",
      name: "Attackers",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: attacker,
      status: { moved: rng() < 0.5, charged: rng() < 0.3 },
    },
    models: Array.from({ length: shooters }, (_, i) =>
      model(`a${i}`, "p1", i * 2 - 4, -near - rng() * (kind === "melee" ? 1.5 : 30), { M: '6"' }, ["w"]),
    ),
  });
  const targetKeywords = [pickFrom(rng, ["Infantry", "Vehicle", "Monster"])];
  const abilities = [
    ...(rng() < 0.3 ? [{ name: `Feel No Pain ${pickFrom(rng, ["4", "5", "6"])}+`, text: "" }] : []),
    ...(rng() < 0.2
      ? [
          {
            name: "Invulnerable Save",
            text: `This model has a ${pickFrom(rng, ["4", "5"])}+ invulnerable save.`,
          },
        ]
      : []),
  ];
  const tchars: Record<string, string> = {
    T: pickFrom(rng, ["3", "4", "5", "8", "10"]),
    SV: pickFrom(rng, ["2+", "3+", "4+", "6+"]),
    W: pickFrom(rng, ["1", "2", "3"]),
    // An invulnerable save comes from the profile or an ability, not both.
    ...(rng() < 0.2 && !abilities.some((x) => /invulnerable/i.test(x.name))
      ? { INV: pickFrom(rng, ["4+", "5+"]) }
      : {}),
  };
  const targets = 1 + Math.floor(rng() * 10);
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "t",
      owner: "p2",
      name: "Targets",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: { weapons: {}, abilities, keywords: targetKeywords },
    },
    models: Array.from({ length: targets }, (_, i) =>
      model(`t${i}`, "p2", (i % 5) * 1.5 - 3, Math.floor(i / 5) * 1.5, tchars),
    ),
  });
  // Terrain sometimes: a ruin over the targets (cover) or a tall ruin for the shooters (higher ground).
  const roll = rng();
  if (roll < 0.25) s = { ...s, terrain: [makePiece("Ruin", "r1", { x: 0, y: 1 })] };
  else if (roll < 0.35) s = { ...s, terrain: [makePiece("Woods", "r2", { x: 0, y: 1 })] };
  return s;
}

const sameDice = (a: string, b: string) => {
  const x = parseDiceSum(a);
  const y = parseDiceSum(b);
  return averageSum(x) === averageSum(y) && x.length === y.length;
};
const clamp = (n: number) => Math.max(-1, Math.min(1, n));

describe("attack suggestion parity with the hand-written rules", () => {
  it("proposes the same numbers over 1500 random tables", () => {
    const pick = mulberry(7);
    let compared = 0;
    // Make sure the random tables exercise the interesting rules.
    const seen = {
      cover: 0,
      higherHit: 0,
      fnp: 0,
      anti: 0,
      torrent: 0,
      melta: 0,
      rapid: 0,
      invuln: 0,
      saveCover: 0,
    };
    for (let i = 0; i < 1500; i++) {
      const s = randomTable(pick);
      const before = legacySuggestAttack(s, "a", "w", "t");
      const after = suggestAttack(s, "a", "w", "t");
      expect(!!after).toBe(!!before);
      if (!before || !after) continue;
      const where = `table ${i}: ${JSON.stringify(s.units.a?.sheet?.weapons.w)} vs ${JSON.stringify(s.models.t0?.profile)}`;
      const o = before.spec;
      const n = after.spec;
      expect(after.inRange, `${where} inRange`).toBe(before.inRange);
      expect(after.carriers, `${where} carriers`).toBe(before.carriers);
      expect(sameDice(n.attacks, o.attacks), `${where} attacks ${n.attacks} vs ${o.attacks}`).toBe(true);
      expect(n.hit, `${where} hit`).toBe(o.hit);
      expect(n.hitMod, `${where} hitMod`).toBe(clamp(o.hitMod));
      expect(n.critHit, `${where} critHit`).toBe(o.critHit);
      expect(n.rerollHits, `${where} rerollHits`).toBe(o.rerollHits);
      expect(n.sustained, `${where} sustained`).toBe(o.sustained);
      expect(n.lethal, `${where} lethal`).toBe(o.lethal);
      expect(n.wound, `${where} wound`).toBe(o.wound);
      expect(n.woundMod, `${where} woundMod`).toBe(clamp(o.woundMod));
      expect(n.critWound, `${where} critWound`).toBe(o.critWound);
      expect(n.rerollWounds, `${where} rerollWounds`).toBe(o.rerollWounds);
      expect(n.devastating, `${where} devastating`).toBe(o.devastating);
      expect(n.save, `${where} save`).toBe(o.save);
      expect(sameDice(n.damage, o.damage), `${where} damage ${n.damage} vs ${o.damage}`).toBe(true);
      expect(n.fnp, `${where} fnp`).toBe(o.fnp);
      expect(after.visible, `${where} visible`).toBe(before.visible);
      expect(after.inCover, `${where} inCover`).toBe(before.inCover);
      compared++;
      const kws = s.units.a?.sheet?.weapons.w?.keywords.join(" ") ?? "";
      if (before.inCover > 0 && before.inCover >= before.visible) seen.cover++;
      if (s.settings.cover === "save" && before.inCover > 0 && before.inCover >= before.visible)
        seen.saveCover++;
      if (o.hitMod > 0) seen.higherHit++;
      if (o.fnp) seen.fnp++;
      if (o.critWound < 6) seen.anti++;
      if (o.hit === null) seen.torrent++;
      if (/melta/i.test(kws) && /\+/.test(o.damage)) seen.melta++;
      if (/rapid/i.test(kws) && before.inRange > 0) seen.rapid++;
      if (s.units.t?.sheet?.abilities.some((x) => /invulnerable/i.test(x.name))) seen.invuln++;
    }
    expect(compared).toBeGreaterThan(1000);
    for (const [what, n] of Object.entries(seen)) expect(n, what).toBeGreaterThan(5);
  });
});
