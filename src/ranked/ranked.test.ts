import riftSource from "../../games/rift-lanterns/rift-lanterns.js?raw";
import brineSource from "../../games/brinewatch/brinewatch.js?raw";
import pkg from "../../package.json";
import { describe, expect, it } from "vitest";
import "../systems";
import {
  applyEvent,
  createInitialState,
  createRecord,
  resolveIntent,
  type GameState,
  type Intent,
} from "../core";
import { canonResult, rankedResultOf, type RankedPackage, type RankedResult } from "../core/ranked";
import { sign, type Identity } from "../mail/keys";
import { keyOf } from "../player/card";
import {
  change,
  counted,
  expected,
  K,
  ladder,
  ladderKey,
  PAIR_CAP,
  ratingMove,
  rankedSystems,
  rulesetOf,
  START,
} from "./ratings";
import { signRate } from "./store";
import {
  checkDeclined,
  checkSigned,
  declineText,
  replayHash,
  signingText,
  type DeclinedResult,
  type SignedResult,
} from "./verify";

async function newIdentity(): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

const HASH = "a".repeat(64);

function result(a: string, b: string, va: number, vb: number, at = 1_000_000, replay = HASH): RankedResult {
  return {
    v: 1,
    system: "rift-lanterns",
    points: null,
    rounds: 5,
    players: [
      { key: a, name: "Ana", vp: va },
      { key: b, name: "Ben", vp: vb },
    ],
    winner: va === vb ? null : va > vb ? 0 : 1,
    replay,
    at,
    rules: { app: "0.1.0+test", packages: [] },
  };
}

async function signed(r: RankedResult, ids: [Identity, Identity]): Promise<SignedResult> {
  const text = signingText(canonResult(r)!);
  return { result: r, sigs: [await sign(text, ids[0]), await sign(text, ids[1])] };
}

/** A result already checked, for the rating maths (no signatures needed there). */
const counts = (a: string, b: string, va: number, vb: number, at: number, n = 0): SignedResult => ({
  result: result(a, b, va, vb, at, n.toString(16).padStart(64, "0")),
  sigs: ["", ""],
});

describe("ranked results (#65)", () => {
  it("counts a result only with both players' signatures on exactly it", async () => {
    const ids: [Identity, Identity] = [await newIdentity(), await newIdentity()];
    const [a, b] = ids.map((i) => keyOf(i.publicKey)) as [string, string];
    const good = await signed(result(a, b, 12, 8), ids);
    expect(await checkSigned(good)).not.toBeNull();
    // Any change to what was signed, the signatures swapped, or one signer twice: not counted.
    expect(
      await checkSigned({
        ...good,
        result: {
          ...good.result,
          players: [{ ...good.result.players[0], vp: 13 }, good.result.players[1]],
          winner: 0,
        },
      }),
    ).toBeNull();
    expect(await checkSigned({ ...good, sigs: [good.sigs[1], good.sigs[0]] })).toBeNull();
    expect(await checkSigned({ ...good, sigs: [good.sigs[0], good.sigs[0]] })).toBeNull();
    const byOne = await signed(result(a, b, 12, 8), [ids[0], ids[0]]);
    expect(await checkSigned(byOne)).toBeNull();
  });

  it("keeps a refusal only with the decliner's own signature on it (PX ranked 1)", async () => {
    const ids: [Identity, Identity] = [await newIdentity(), await newIdentity()];
    const [a, b] = ids.map((i) => keyOf(i.publicKey)) as [string, string];
    const r = result(a, b, 12, 8);
    const canon = canonResult(r)!;
    // Ana won and signed; Ben declined, saying something went wrong.
    const refused: DeclinedResult = {
      result: r,
      sigs: [await sign(signingText(canon), ids[0]), null],
      declined: { seat: 1, why: "broke", sig: await sign(declineText(canon, "broke"), ids[1]) },
    };
    expect(await checkDeclined(refused)).not.toBeNull();
    // Made up by Ana: her signature on Ben's refusal doesn't hold.
    const madeUp = {
      ...refused,
      declined: { ...refused.declined, sig: await sign(declineText(canon, "broke"), ids[0]) },
    };
    expect(await checkDeclined(madeUp)).toBeNull();
    // Another reason than the one signed, or a "score" refusal, doesn't hold either.
    expect(await checkDeclined({ ...refused, declined: { ...refused.declined, why: "agreed" } })).toBeNull();
    expect(await checkDeclined({ ...refused, declined: { ...refused.declined, why: "score" } })).toBeNull();
    // A refusal never passes as a signed result.
    expect(await checkSigned(refused)).toBeNull();
    // Sign rates: Ana signed it, Ben didn't.
    const signedOne = { [HASH]: await signed(result(a, b, 1, 2, 5, "b".repeat(64)), ids) };
    const declined = { [r.replay]: refused };
    expect(signRate(a, signedOne, declined)).toEqual({ signed: 2, of: 2 });
    expect(signRate(b, signedOne, declined)).toEqual({ signed: 1, of: 2 });
  });

  it("refuses results that disagree with themselves", () => {
    const [a, b] = ["x".repeat(43) + "." + "y".repeat(43), "z".repeat(43) + "." + "w".repeat(43)];
    expect(canonResult(result(a, b, 3, 1))).not.toBeNull();
    expect(canonResult({ ...result(a, b, 3, 1), winner: 1 })).toBeNull();
    expect(canonResult(result(a, a, 3, 1))).toBeNull();
    expect(canonResult({ ...result(a, b, 3, 1), replay: "nothex" })).toBeNull();
    // The same result spelled in another key order signs the same.
    const r = result(a, b, 3, 1);
    const shuffled = {
      at: r.at,
      replay: r.replay,
      winner: r.winner,
      players: r.players,
      rounds: r.rounds,
      points: r.points,
      system: r.system,
      rules: r.rules,
      v: 1,
    };
    expect(canonResult(shuffled)).toBe(canonResult(r));
  });

  it("hashes the game's events before the result, leaving ranked bookkeeping out", async () => {
    const record = createRecord();
    const e = (seq: number, type: string) =>
      ({
        seq,
        by: "a",
        at: seq,
        event:
          type === "dice"
            ? { type: "dice/roll", roll: { by: "a", sides: 6, results: [seq] } }
            : { type: "ranked/sign", player: "a", sig: null },
      }) as never;
    const plain = { ...record, events: [e(1, "dice"), e(2, "dice")] };
    const withCards = { ...record, events: [e(1, "dice"), e(2, "ranked"), e(3, "dice"), e(4, "dice")] };
    // seq 3 is a different roll from seq 2, so compare against the events as they stand.
    expect(await replayHash(plain)).not.toBe(await replayHash(withCards));
    expect(await replayHash(withCards, 3)).toBe(
      await replayHash({ ...record, events: [e(1, "dice"), e(3, "dice")] }),
    );
  });
});

const RL = "rift-lanterns@0.1.0";
/** The Elo maths alone: every key counts from its first game. */
const OPEN = { games: 0, opponents: 0 };

describe("ratings with no server (#65)", () => {
  const A = "a".repeat(43) + "." + "a".repeat(43);
  const B = "b".repeat(43) + "." + "b".repeat(43);
  const C = "c".repeat(43) + "." + "c".repeat(43);

  it("moves Elo by K times the surprise", () => {
    expect(expected(START, START)).toBe(0.5);
    expect(change(START, START, 1)).toBe(K / 2);
    const [a, b] = ladder([counts(A, B, 10, 2, 1)], RL, OPEN);
    expect([a!.key, a!.rating, a!.wins]).toEqual([A, START + 16, 1]);
    expect([b!.key, b!.rating, b!.losses]).toEqual([B, START - 16, 1]);
    // A draw between equals changes nothing.
    expect(ladder([counts(A, B, 4, 4, 1)], RL, OPEN).map((r) => r.rating)).toEqual([START, START]);
  });

  it("puts the winner first when new players' ratings are held level", () => {
    // B beat A; neither is established, so both stay at the start.
    const [first, second] = ladder([counts(B, A, 10, 2, 1)], RL);
    expect([first!.key, first!.rating, second!.rating]).toEqual([B, START, START]);
  });

  it("says how one game moved each player (PX ranked 2)", () => {
    const first = counts(A, B, 10, 2, 1, 1);
    const second = counts(B, A, 3, 1, 2 * 24 * 3600_000, 2);
    const results = [first, second];
    const win = ratingMove(results, RL, first.result.replay, A, OPEN)!;
    expect(win).toMatchObject({ before: START, after: START + 16, delta: 16, games: 1 });
    expect(win.them).toEqual({ name: "Ben", rating: START - 16 });
    const back = ratingMove(results, RL, second.result.replay, A, OPEN)!;
    expect(back.before).toBe(START + 16);
    expect(back.delta).toBeLessThan(-16);
    expect(ratingMove(results, RL, "f".repeat(64), A, OPEN)).toBeNull();
  });

  it("agrees on the ladder whatever order the results arrived in, each replay once", () => {
    const day = 24 * 3600_000;
    const all = [
      counts(A, B, 5, 1, 1 * day, 1),
      counts(B, C, 5, 1, 2 * day, 2),
      counts(C, A, 5, 1, 3 * day, 3),
      counts(A, C, 5, 1, 4 * day, 4),
    ];
    const one = ladder(all, RL, OPEN);
    const other = ladder([...all].reverse().concat(all[0]!), RL, OPEN);
    expect(other).toEqual(one);
    expect(one.reduce((n, r) => n + r.games, 0)).toBe(8);
  });

  it("counts at most PAIR_CAP games a day between the same two players", () => {
    const games = Array.from({ length: 6 }, (_, i) => counts(A, B, 5, 1, 1000 + i * 60_000, i));
    expect(counted(games, RL)).toHaveLength(PAIR_CAP);
    // A day later the pair counts again; other systems don't mix in.
    const later = counts(B, A, 5, 1, 1000 + 25 * 3600_000, 99);
    expect(counted([...games, later], RL)).toHaveLength(PAIR_CAP + 1);
    expect(ladder(games, "forty-k-11@0.1.0")).toEqual([]);
  });

  it("moves no rating against a key that hasn't met enough players (farming)", () => {
    const day = 24 * 3600_000;
    // A beats a fresh key three times: nothing moves for A, though the games count.
    const farm = Array.from({ length: 3 }, (_, i) => counts(A, B, 5, 1, i * day, i));
    const [a] = ladder(farm, RL);
    expect([a!.key, a!.rating, a!.games]).toEqual([A, START, 3]);
    // Once B has played five games against three players, beating B counts.
    const D = "d".repeat(43) + "." + "d".repeat(43);
    const rounds = [
      counts(B, C, 5, 1, 4 * day, 10),
      counts(B, D, 5, 1, 5 * day, 11),
      counts(A, B, 5, 1, 6 * day, 12),
    ];
    const moved = ladder([...farm, ...rounds], RL).find((r) => r.key === A)!;
    expect(moved.rating).toBeGreaterThan(START);
    const held = ratingMove([...farm, ...rounds], RL, farm[0]!.result.replay, A)!;
    expect(held).toMatchObject({ delta: 0, held: true });
  });
});

describe("a ranked game in the log (#65)", () => {
  const play = (s: GameState, intent: Intent, from: string): GameState => {
    const e = resolveIntent(intent, from, () => 0.5, s);
    if (!e) throw new Error(`Rejected ${intent.type}`);
    return applyEvent({ ...s, seq: s.seq + 1 }, e);
  };
  const refused = (s: GameState, intent: Intent, from: string) =>
    resolveIntent(intent, from, () => 0.5, s) === null;
  const A = "a".repeat(43) + "." + "a".repeat(43);
  const B = "b".repeat(43) + "." + "b".repeat(43);

  it("takes both keys, then one result after the battle, then each signature once", () => {
    let s = createInitialState();
    s = play(s, { type: "player/join", player: { id: "a", name: "Ana", color: "#00f", seat: 0 } }, "a");
    s = play(s, { type: "player/join", player: { id: "b", name: "Ben", color: "#f00", seat: 1 } }, "b");
    s = play(s, { type: "ranked/card", key: A }, "a");
    expect(refused(s, { type: "ranked/card", key: "not a key" }, "b")).toBe(true);
    s = play(s, { type: "ranked/card", key: B }, "b");
    // Not before the battle is over.
    const early = rankedResultOf(s, HASH, 5)!;
    expect(refused(s, { type: "ranked/result", result: early }, "a")).toBe(true);
    s = { ...s, turn: { ...s.turn, round: 99 }, resources: { a: { VP: 12 }, b: { VP: 8 } } };
    const r = rankedResultOf(s, HASH, 5)!;
    expect(r.winner).toBe(0);
    // Only the score the table shows.
    expect(
      refused(
        s,
        { type: "ranked/result", result: { ...r, players: [{ ...r.players[0], vp: 30 }, r.players[1]] } },
        "a",
      ),
    ).toBe(true);
    s = play(s, { type: "ranked/result", result: r }, "b");
    expect(refused(s, { type: "ranked/result", result: r }, "a")).toBe(true);
    expect(refused(s, { type: "ranked/card", key: null }, "a")).toBe(true);
    s = play(s, { type: "ranked/sign", sig: "s".repeat(88) }, "a");
    expect(refused(s, { type: "ranked/sign", sig: "s".repeat(88) }, "a")).toBe(true);
    // "The score is wrong": the result comes down until the table says it's fixed, then it's written again.
    s = play(s, { type: "ranked/sign", sig: null, why: "score" }, "b");
    expect(s.ranked?.result).toBeUndefined();
    expect(s.ranked?.sigs).toEqual({});
    expect(refused(s, { type: "ranked/result", result: r }, "a")).toBe(true);
    s = play(s, { type: "ranked/fixed" }, "a");
    s = { ...s, resources: { a: { VP: 12 }, b: { VP: 10 } } };
    const fixed = rankedResultOf(s, HASH, 6)!;
    s = play(s, { type: "ranked/result", result: fixed }, "a");
    s = play(s, { type: "ranked/sign", sig: "s".repeat(88) }, "a");
    s = play(s, { type: "ranked/sign", sig: null, why: "agreed", decline: "d".repeat(88) }, "b");
    expect(s.ranked?.sigs).toEqual({ a: "s".repeat(88), b: null });
    expect(s.ranked?.whys).toEqual({ b: "agreed" });
    expect(s.ranked?.declines).toEqual({ b: "d".repeat(88) });
    expect(s.ranked?.fixes).toBe(1);
  });
});

describe("ladders by the rules played (docs/compatibility.md)", () => {
  const A = "a".repeat(43) + "." + "a".repeat(43);
  const B = "b".repeat(43) + "." + "b".repeat(43);
  const game = {
    id: "open-battle.rift-lanterns",
    name: "Rift Lanterns",
    version: "1.3.2",
    hash: "1".repeat(64),
    game: true as const,
  };
  const scars = { id: "you.scars", name: "Scars", version: "1.0.0", hash: "2".repeat(64) };
  const withRules = (r: SignedResult, packages: RankedPackage[]) => ({
    ...r,
    result: { ...r.result, rules: { app: "0.1.0+abc", packages } },
  });

  it("signs the rules only when a result has them, so older results still verify", () => {
    const plain = { ...result(A, B, 3, 1), rules: undefined };
    expect(canonResult(plain)).not.toContain("rules");
    const ruled = { ...plain, rules: { packages: [scars, game] } };
    const canon = JSON.parse(canonResult(ruled)!);
    // Sorted by id, whatever order they came in.
    expect(canon.rules.packages.map((p: { id: string }) => p.id)).toEqual([
      "open-battle.rift-lanterns",
      "you.scars",
    ]);
    expect(canonResult({ ...plain, rules: { packages: [{ ...scars, hash: "nope" }] } })).toBeNull();
    expect(canonResult({ ...plain, rules: { packages: [{ ...scars, game: "yes" }] } })).toBeNull();
  });

  it("records the packages the game ran, the game's own marked, and the writer's build", () => {
    let s = createInitialState();
    s = {
      ...s,
      players: {
        a: { id: "a", name: "Ana", color: "#00f", seat: 0 },
        b: { id: "b", name: "Ben", color: "#f00", seat: 1 },
      },
    } as GameState;
    s = { ...s, ranked: { keys: { a: A, b: B }, sigs: {} } };
    s = {
      ...s,
      packages: {
        app: "0.1.0+abc",
        system: { id: "rift-lanterns", builtIn: false },
        packages: [
          { ...game, bytes: 1, game: undefined, kind: "system" },
          { ...scars, bytes: 1 },
        ],
      },
    } as GameState;
    expect(rankedResultOf(s, HASH, 5)!.rules).toEqual({ app: "0.1.0+abc", packages: [game, scars] });
    expect(rankedResultOf(s, HASH, 5, "0.2.0+def")!.rules!.app).toBe("0.2.0+def");
  });

  it("gives different rules different ladders, and a named ruleset one ladder", () => {
    const rulesets = [
      {
        id: "rl-s1",
        name: "Rift Lanterns, season 1",
        system: "rift-lanterns",
        versions: ["0.1.0"],
        packages: [[game.hash], ["4".repeat(64)]],
      },
    ];
    const key = (packages: RankedPackage[], app = "0.1.0+abc") =>
      ladderKey({ ...result(A, B, 1, 0), rules: { app, packages } }, rulesets);
    // Two copies of the season's game, a typo fix apart, share its ladder.
    expect(key([game])).toBe("rl-s1");
    expect(key([{ ...game, hash: "4".repeat(64) }])).toBe("rl-s1");
    // A buffed copy of the game, house rules, or another app version don't.
    expect(key([{ ...game, hash: "5".repeat(64) }])).toBe(`rift-lanterns@0.1.0+${"5".repeat(64)}`);
    expect(key([game, scars])).toBe(`rift-lanterns@0.1.0+${"1".repeat(64)}+${"2".repeat(64)}`);
    expect(key([game, scars])).toBe(key([scars, game]));
    expect(key([game], "0.1.0-fork.mine+abc")).toBe(`rift-lanterns@0.1.0-fork.mine+${"1".repeat(64)}`);
    // Results from before rulesets keep to themselves.
    expect(ladderKey({ ...result(A, B, 1, 0), rules: undefined }, rulesets)).toBe("rift-lanterns+legacy");
    const all = [counts(A, B, 1, 0, 1, 1), withRules(counts(A, B, 1, 0, 2, 2), [scars])];
    expect(rankedSystems(all)).toHaveLength(2);
  });

  it("lists the shipped games' current files in rulesets.json", async () => {
    for (const [system, source] of [
      ["rift-lanterns", riftSource],
      ["brinewatch", brineSource],
    ] as const) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      const hash = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
      const named = rulesetOf({
        ...result(A, B, 1, 0),
        system,
        rules: {
          app: `${pkg.version}+x`,
          packages: [{ id: "x", name: "x", version: "1", hash, game: true }],
        },
      });
      // Changed the game? Add its hash to its season (plays the same) or start a new one (docs/compatibility.md).
      expect(named?.system, `${system} (${hash}) isn't in rulesets.json for ${pkg.version}`).toBe(system);
    }
  });
});
