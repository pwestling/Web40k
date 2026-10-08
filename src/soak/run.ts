import {
  branchRecord,
  lastSeq,
  sha256Hex,
  stateAt,
  stateHash,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
} from "../core";
import { restoreSystems } from "../core/content/systems";
import { currentSlot } from "../core/content/turn";
import { createLoopbackNetwork } from "../net/loopback";
import { Session, setIntentRouter, type Role } from "../net/session";
import { SandboxEngine } from "../sandbox/engine";
import { seededRng } from "../sandbox/protocol";
import { gameModule, systemModule } from "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import {
  battleOver,
  freeMoves,
  lastRound,
  legal,
  waitingOn,
  type BotContext,
  type BotMove,
  undoMove,
  type Kept,
} from "./bot";

/**
 * A soak game: the bot plays a whole game over loopback peers (a host, a
 * client, a third peer watching or playing), and on the way makes trouble
 * on purpose: a guest drops and comes back, the host's tab dies so the room
 * picks a new host, the game is branched with What if and play goes on in
 * the branch, and (where there is one for the game) the example rules
 * package is loaded mid-game. A game passes only if no peer's table ever
 * differs from the host's, every peer's log folds back to the state it
 * holds, nothing throws, and the game never sits on a question nobody can
 * answer.
 */

export interface SoakOptions {
  system: string;
  seed: number;
  /** Players a side: 2 for a 2v2 game over three peers (the host plays two seats). */
  teamSize?: 1 | 2;
  /** Make trouble mid-game (on by default). */
  trouble?: boolean;
  /** A rules package to load mid-game, for systems it applies to. */
  pkg?: { source: string; systems: string[] };
  maxSteps?: number;
  /** Test the checks themselves: from this move on, a guest's table keeps drifting from the host's (a reducer bug). */
  drift?: number;
  /** Confirm every ability the system can play for you (40k #38) once the armies are down. */
  automate?: boolean;
  /** Other armies than the system's samples (a scenario's), by seat. */
  armies?: (seat: 0 | 1) => ReturnType<ReturnType<typeof systemModule>["sample"]>;
  /**
   * A scenario's probe: after each move, tags for what it's looking for on the
   * host's table (e.g. "damage re-rolled"). The report counts them, so a
   * scenario can check a closed rules gap really came up and stays fixed.
   */
  watch?: (s: GameState) => string[];
}

export interface SoakReport {
  system: string;
  seed: number;
  ok: boolean;
  failures: string[];
  steps: number;
  round: number;
  finished: boolean;
  events: number;
  /** Trouble made, in order. */
  trouble: string[];
  /** Moves made, by kind. */
  kinds: Record<string, number>;
  /** Tags from `watch`, counted once per move they were seen after. */
  seen: Record<string, number>;
}

const GRACE = 5;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const TRACE = !!env.SOAK_TRACE;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const settle = () => sleep(GRACE * 6);
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706"];

class Failure extends Error {}

/** One room of loopback peers. */
class Room {
  readonly net = createLoopbackNetwork();
  readonly peers = new Map<string, Session>();
  private n = 0;
  constructor(
    private readonly seed: number,
    private readonly clock: () => number,
    private readonly errors: string[],
  ) {}

  join(id: string, role: Role, record?: GameRecord, resumed = false): Session {
    const session = new Session({
      transport: this.net.connect(id),
      role,
      onChange: () => {},
      graceMs: GRACE,
      rng: seededRng(this.seed * 7919 + ++this.n * 104729),
      now: this.clock,
      ...(record ? { record } : {}),
      resumed,
    });
    this.peers.set(id, session);
    return session;
  }

  leave(id: string): GameRecord {
    const s = this.peers.get(id)!;
    const saved = s.log;
    s.leave();
    this.peers.delete(id);
    return saved;
  }

  host(): Session | undefined {
    return [...this.peers.values()].find((s) => s.status.role === "host");
  }

  /** Where a player's moves are sent from: their own peer, or the host acting for them (a second seat). */
  send(move: BotMove): void {
    const own = this.peers.get(move.as);
    try {
      if (own && own.status.role !== "spectator") own.dispatch(move.intent);
      else this.host()?.dispatch(move.intent, move.as);
    } catch (e) {
      this.errors.push(
        `threw on ${move.intent.type}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
    }
  }

  close(): void {
    for (const id of [...this.peers.keys()]) this.leave(id);
  }
}

const hashOf = (s: GameState) => stateHash(s);

export async function soak(opts: SoakOptions): Promise<SoakReport> {
  const { system, seed } = opts;
  const teamSize = opts.teamSize ?? 1;
  const trouble = opts.trouble ?? true;
  const maxSteps = opts.maxSteps ?? 5000;
  const rng = seededRng(seed);
  const failures: string[] = [];
  const errors: string[] = [];
  const done: string[] = [];
  const kinds: Record<string, number> = {};
  const seen: Record<string, number> = {};
  let clock = 1;
  const now = () => clock;
  let room = new Room(seed, now, errors);
  const kept: Kept = new Map();
  let engine: SandboxEngine | null = null;
  let fed = 0;
  const ctx: BotContext = { rng, kept, idle: 0 };
  let steps = 0;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;

  const fail = (why: string): never => {
    throw new Failure(why);
  };

  try {
    // Set up: the host's seat, the game, its table and mission, then the others join.
    const host0 = room.join("h", "host");
    const mod = systemModule(system);
    const as = (p: PlayerId, intent: Intent) => room.send({ intent, as: p, kind: "setup" });
    as("h", { type: "player/join", player: { id: "h", name: "Host", color: COLORS[0]!, seat: 0 } });
    if (teamSize > 1) as("h", { type: "settings/set", settings: { teamSize } });
    as("h", { type: "game/system", system });
    as("h", { type: "layout/set", layout: mod.layout(host0.current.table) });
    const mission = mod.missions?.[0];
    if (mission) {
      const { zones, objectives } = mission.setup(host0.current.table);
      as("h", { type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives });
    }
    room.join("c", "client");
    room.join("d", teamSize > 1 ? "client" : "spectator");
    await settle();
    const seats: [PlayerId, number][] =
      teamSize > 1
        ? [
            ["h", 0],
            ["c", 1],
            ["d", 0],
            ["x", 1],
          ]
        : [
            ["h", 0],
            ["c", 1],
          ];
    for (const [id, seat] of seats.slice(1))
      as(id, {
        type: "player/join",
        player: { id, name: `P${id}`, color: COLORS[seats.findIndex((s) => s[0] === id)]!, seat },
      });
    const ranked = (gameModule(system)?.system.unitShape.kind ?? "") === "ranked";
    for (const [id, seat] of seats) {
      const units = (opts.armies ?? mod.sample)(seat === 1 ? 1 : 0).units.map((u) =>
        ranked && !u.files
          ? { ...u, files: Math.min(u.models.length, u.models.length >= 10 ? 5 : u.models.length) }
          : u,
      );
      for (const i of spawnIntents(room.host()!.current, id, units, `${id}-${seed}`, "sample")) as(id, i);
    }
    if (opts.automate && mod.recognizeAbility) {
      const rules = gameModule(system)!.system;
      for (const u of Object.values(room.host()!.current.units))
        for (const ability of u.sheet?.abilities ?? []) {
          const auto = mod.recognizeAbility(ability, rules);
          if (auto) as(u.owner, { type: "unit/automate", id: u.id, ability: ability.name, auto });
        }
    }
    // Everything starts on the table, so the game has something to do from round 1.
    for (const u of Object.values(room.host()!.current.units))
      if (u.status?.reserves) as(u.owner, { type: "unit/reserve", id: u.id, reserve: false, moves: [] });
    check("setup");

    // The trouble, at random points once the battle is on.
    const rounds = lastRound(room.host()!.current);
    const at = (lo: number) => Math.min(rounds - 1, lo + Math.floor(rng() * 2));
    const plan = trouble
      ? [
          ...(opts.pkg?.systems.includes(system)
            ? [{ what: "package", round: 1, wait: Math.floor(rng() * 20) }]
            : []),
          { what: "drop", round: at(1), wait: Math.floor(rng() * 30) },
          { what: "host", round: at(2), wait: Math.floor(rng() * 30) },
          { what: "branch", round: at(3), wait: Math.floor(rng() * 30) },
        ]
      : [];
    let roundSteps = 0;
    let lastRoundSeen = 0;
    const away: { id: string; saved: GameRecord; back: number; resumed: boolean }[] = [];

    let mark = "";
    let stuck = 0;
    for (; steps < maxSteps; steps++) {
      clock++;
      // Peers coming back.
      for (const a of away.filter((a) => a.back <= steps)) {
        away.splice(away.indexOf(a), 1);
        const id = `${a.id}${steps}`;
        room.join(id, a.resumed ? "host" : "client", a.saved, a.resumed);
        await settle();
        // Take the seat back if it's still free (a peer still connected keeps theirs).
        const s = room.host()?.current;
        if (s?.players[a.id])
          room.send({ intent: { type: "player/claim", player: a.id }, as: id, kind: "claim" });
        await settle();
        done.push(`${a.id} back as ${id}`);
        check(`rejoin ${id}`);
      }
      const host = room.host();
      if (!host) {
        await settle();
        if (!room.host()) fail("the room has no host after a migration");
        continue;
      }
      const state = host.current;
      if (state.turn.round > 0 && battleOver(state)) break;

      // Make trouble on cue.
      if (state.turn.round !== lastRoundSeen) [lastRoundSeen, roundSteps] = [state.turn.round, 0];
      roundSteps++;
      const due = plan.find(
        (t) => state.turn.round > t.round || (state.turn.round === t.round && roundSteps > t.wait),
      );
      // The host only goes once the dropped guest is back: with no other player, nobody could take over.
      if (due && !(due.what === "host" && away.length)) {
        plan.splice(plan.indexOf(due), 1);
        await makeTrouble(due.what);
        continue;
      }

      if (opts.drift !== undefined && steps >= opts.drift) {
        const guest = [...room.peers.values()].find((p) => p !== host)!;
        const g = guest as unknown as { state: GameState };
        g.state = { ...g.state, table: { ...g.state.table, width: host.current.table.width + 1 } };
      }
      const record = host.log;
      const waiting = waitingOn(record, state, ctx);
      // Now and then someone presses Undo.
      const players = Object.values(state.players).filter((p) => p.seat !== undefined);
      const undo = state.turn.round > 0 && rng() < 0.02 ? undoMove(record, state, pick(players).id) : null;
      let move: BotMove | undefined;
      for (const m of [...(undo ? [undo] : []), ...(waiting ? waiting.moves : freeMoves(state, ctx))])
        if (legal(record, state, m)) {
          move = m;
          break;
        }
      if (!move) {
        if (waiting) {
          if (++stuck > 3) fail(`stuck on ${waiting.what}: no answer the rules accept`);
        } else fail("no legal move at all");
        await settle();
        continue;
      }
      stuck = 0;
      kinds[move.kind] = (kinds[move.kind] ?? 0) + 1;
      if (TRACE)
        console.log(
          `${steps} r${state.turn.round} s${state.turn.activeSeat} ${currentSlot(state)?.id} ${move.kind} ${move.as} idle=${ctx.idle} reserves=${Object.values(state.units).filter((u) => u.status?.reserves).length} acting=${Object.values(state.units).filter((u) => u.status?.acting).length}`,
        );
      const before = lastSeq(record);
      room.send(move);
      if (engine) await sleep(0);
      if (errors.length) fail(errors[0]!);
      const after = room.host();
      if (after && lastSeq(after.log) === before && !after.current.script)
        fail(
          `the host dropped a legal ${move.intent.type} from ${move.as}: ${JSON.stringify(move.intent).slice(0, 200)}`,
        );
      // A move that goes with it (a charge's move into contact).
      if (move.then && room.host()) {
        room.send(move.then);
        if (engine) await sleep(0);
        if (errors.length) fail(errors[0]!);
      }
      const s = room.host()!.current;
      const m = `${s.turn.round}:${s.turn.activeSeat}:${currentSlot(s)?.id}:${s.turn.phase}:${Object.values(
        s.units,
      )
        .filter((u) => u.status?.acting)
        .map((u) => u.id)
        .join()}`;
      ctx.idle = m === mark ? ctx.idle + 1 : 0;
      mark = m;
      if (opts.watch) for (const tag of new Set(opts.watch(s))) seen[tag] = (seen[tag] ?? 0) + 1;
      lockstep(steps % 25 === 0, steps % 250 === 0);
    }
    await settle();
    check("the end");
    const last = room.host()!.current;
    if (!battleOver(last)) fail(`didn't finish in ${maxSteps} moves (round ${last.turn.round})`);
    if (last.script?.waiting) fail(`left waiting on "${last.script.waiting.question}"`);

    async function makeTrouble(what: string) {
      const host = room.host()!;
      if (what === "drop") {
        // A guest's tab closes and comes back later with the log it saved.
        const id = [...room.peers.keys()].find(
          (p) => p !== host.selfId && room.peers.get(p)!.status.role === "client",
        );
        if (!id) return;
        const saved = room.leave(id);
        away.push({ id, saved, back: steps + 5 + Math.floor(rng() * 25), resumed: false });
        done.push(`dropped ${id} at round ${host.current.turn.round}`);
        await settle();
        return;
      }
      if (what === "host") {
        // The host's tab dies: the room waits, picks a new host, and the old one comes back later.
        const id = host.selfId;
        const saved = room.leave(id);
        away.push({ id, saved, back: steps + 10 + Math.floor(rng() * 30), resumed: true });
        await settle();
        await settle();
        const next = room.host();
        if (!next) fail("nobody took over as host");
        done.push(`host ${id} lost at round ${host.current.turn.round}, ${next!.selfId} took over`);
        check("migration");
        return;
      }
      if (what === "branch") {
        // What if: branch from a moment a little back, then play on in the branch with everyone.
        await settle();
        check("before branching");
        const parent = host.log;
        const seq = Math.max(parent.initial.seq + 1, lastSeq(parent) - Math.floor(rng() * 30));
        const branch = branchRecord(parent, seq, host.selfId, "soak");
        const players = Object.values(stateAt(branch).players).filter((p) => p.seat !== undefined);
        away.length = 0;
        room.close();
        room = new Room(seed + 1, now, errors);
        const ids = players.map((p) => p.id);
        const nh = `b${ids[0]}`;
        room.join(nh, "host", branch);
        room.join(`b${ids[1]}`, "client");
        room.join(teamSize > 1 ? `b${ids[2]}` : "bs", teamSize > 1 ? "client" : "spectator");
        await settle();
        // Each peer takes back its player's seat; the host also plays any seat left over.
        for (const p of players.slice(0, teamSize > 1 ? 3 : 2))
          room.send({ intent: { type: "player/claim", player: p.id }, as: `b${p.id}`, kind: "claim" });
        await settle();
        done.push(`branched at ${seq} into round ${room.host()!.current.turn.round}`);
        check("branch");
        if (engine) feedEngine(true);
        return;
      }
      if (what === "package" && opts.pkg) {
        // The example rules package, agreed mid-game: proposed, accepted, then running on the host.
        const source = opts.pkg.source;
        const hash = sha256Hex(source);
        const ref = { id: "soak-example", name: "Example", version: "1.0.0", hash, bytes: source.length };
        const s = host.current;
        const players = Object.values(s.players).filter((p) => p.seat !== undefined);
        room.send({
          intent: { type: "packages/propose", packages: [ref] },
          as: players[0]!.id,
          kind: "package",
        });
        for (const p of players.slice(1))
          room.send({ intent: { type: "packages/accept" }, as: p.id, kind: "package" });
        room.send({
          intent: {
            type: "game/packages",
            app: "soak",
            system: { id: system, builtIn: true },
            packages: [ref],
            agreed: players.map((p) => p.id),
          },
          as: players[0]!.id,
          kind: "package",
        });
        engine = new SandboxEngine(
          (src) =>
            import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(src)}`) as Promise<{
              default?: unknown;
            }>,
        );
        const loaded = await engine.load([{ hash, source }]);
        if (loaded.errors.length) fail(`the example package didn't load: ${loaded.errors[0]!.error}`);
        feedEngine(true);
        const box = engine;
        setIntentRouter((intent, from) => (seed) => {
          feedEngine();
          try {
            return Promise.resolve(box.resolve(intent, from, seed));
          } catch (e) {
            errors.push(`package threw on ${intent.type}: ${e instanceof Error ? e.message : String(e)}`);
            return Promise.resolve(null);
          }
        });
        ctx.packageActions = (unitId, player) => {
          feedEngine();
          return box.unitActions(unitId, player);
        };
        await settle();
        done.push(`loaded the example package at round ${host.current.turn.round}`);
        check("package");
      }
    }

    function feedEngine(all = false) {
      const log = room.host()?.log;
      if (!engine || !log) return;
      if (all || fed > lastSeq(log)) {
        engine.init(log);
        fed = lastSeq(log);
        return;
      }
      const events = log.events.filter((e) => e.seq > fed);
      if (events.length) engine.events(events);
      fed = lastSeq(log);
    }
  } catch (e) {
    failures.push(
      e instanceof Failure ? e.message : `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
    );
  } finally {
    if (engine) {
      setIntentRouter(null);
      restoreSystems();
    }
  }
  const host = room.host();
  const last = host?.current;
  room.close();
  return {
    system,
    seed,
    ok: failures.length === 0,
    failures,
    steps,
    round: last?.turn.round ?? 0,
    finished: !!last && battleOver(last),
    events: host ? lastSeq(host.log) : 0,
    trouble: done,
    kinds,
    seen,
  };

  /** Every peer holds the host's log; with `deep`, their tables hash the same and fold back from their logs. */
  function lockstep(deep: boolean, fold = deep) {
    const host = room.host();
    if (!host) return;
    const seq = lastSeq(host.log);
    for (const [id, s] of room.peers) {
      if (s === host) continue;
      if (s.status.desync) fail(`${id} desynced at event ${s.status.desync.seq}`);
      if (lastSeq(s.log) !== seq) fail(`${id} is at event ${lastSeq(s.log)}, the host at ${seq}`);
      if (deep && hashOf(s.current) !== hashOf(host.current))
        fail(`${id}'s table differs from the host's at event ${seq}`);
    }
    if (fold) {
      const folded = hashOf(stateAt(host.log));
      if (folded !== hashOf(host.current))
        fail(`the host's log doesn't fold back to its table at event ${seq}`);
    }
  }

  function check(where: string) {
    if (errors.length) fail(`${where}: ${errors[0]}`);
    lockstep(true);
    const host = room.host()!;
    for (const [id, s] of room.peers)
      if (JSON.stringify(s.log) !== JSON.stringify(host.log))
        fail(`${where}: ${id}'s log differs from the host's`);
  }
}
