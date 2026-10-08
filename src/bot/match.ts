import {
  lastSeq,
  sha256Hex,
  sides,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
} from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session, setIntentRouter } from "../net/session";
import { SandboxEngine, type ImportSource } from "../sandbox/engine";
import { registerHooks, unregisterHooks } from "../core/script";
import { restoreSystems } from "../core/content/systems";
import { seededRng } from "../sandbox/protocol";
import { gameModule, systemModule } from "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { pendingScores } from "../missions/scoring";
import { battleOver, legal, type BotMove } from "../soak/bot";
import { armyValue } from "./evaluate";
import { missionOf, type Policy, type Seat } from "./policy";
import { actingUnits } from "../core/content/play";

/**
 * A match between two bots (#45): one host session, no network trouble,
 * the system's sample armies on its first mission, played to the end. The
 * harness confirms every score the mission suggests, in full, so neither
 * side can lose points by forgetting; whoever has more VP at the end wins,
 * and on equal VP whoever kept more of their army.
 */

interface MatchOptions {
  system: string;
  seed: number;
  /** A whole game from a package (Rift Lanterns): its code resolves every intent. */
  systemPkg?: { source: string; importSource?: ImportSource };
  maxSteps?: number;
  /** Both sides field the same sample army (this seat's), so the armies don't decide the game. */
  mirror?: 0 | 1;
  /** The side that takes the first turn. */
  first?: number;
  /** Policies aren't told of the moves made (as in the app's package sandbox): they must keep track themselves. */
  blind?: boolean;
}

interface MatchResult {
  system: string;
  seed: number;
  /** The winning seat, or null on a draw. */
  winner: number | null;
  vp: [number, number];
  /** Share of each side's army still standing (by points, or wounds where there are none). */
  kept: [number, number];
  rounds: number;
  steps: number;
  finished: boolean;
  /** Milliseconds each side spent deciding. */
  thinking: [number, number];
  /** Decisions each side made. */
  decisions: [number, number];
  error?: string;
  /** The game as logged, for checks that read it afterwards (stats, moments). */
  record?: GameRecord;
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const TRACE = !!env.BOT_TRACE;
const COLORS = ["#2563eb", "#dc2626"];

const dataImport: ImportSource = (src) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(src)}`) as Promise<{
    default?: unknown;
  }>;

export async function playMatch(
  opts: MatchOptions,
  makePolicies: (start: GameState) => [Policy, Policy],
): Promise<MatchResult> {
  const { system, seed } = opts;
  const maxSteps = opts.maxSteps ?? 4000;
  let clock = 1;
  const net = createLoopbackNetwork();
  const host = new Session({
    transport: net.connect("p0"),
    role: "host",
    onChange: () => {},
    graceMs: 5,
    rng: seededRng(seed * 7919 + 13),
    now: () => clock,
  });
  const errors: string[] = [];
  const send = (intent: Intent, as: PlayerId) => {
    try {
      host.dispatch(intent, as);
    } catch (e) {
      errors.push(`threw on ${intent.type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  let engine: SandboxEngine | null = null;
  let fed = 0;
  const hookOwners: string[] = [];
  const feed = () => {
    if (!engine) return;
    const events = host.log.events.filter((e) => e.seq > fed);
    if (events.length) engine.events(events);
    fed = lastSeq(host.log);
  };
  const result: MatchResult = {
    system,
    seed,
    winner: null,
    vp: [0, 0],
    kept: [1, 1],
    rounds: 0,
    steps: 0,
    finished: false,
    thinking: [0, 0],
    decisions: [0, 0],
  };
  try {
    if (opts.systemPkg) {
      const { source } = opts.systemPkg;
      engine = new SandboxEngine(opts.systemPkg.importSource ?? dataImport);
      const loaded = await engine.load([{ hash: sha256Hex(source), source }]);
      if (loaded.errors.length) throw new Error(`the package didn't load: ${loaded.errors[0]!.error}`);
      for (const p of loaded.packages) {
        for (const s of p.systems) registerHooks(s, p.hash, p.hooks);
        hookOwners.push(p.hash);
      }
      const box = engine;
      engine.init(host.log);
      setIntentRouter((intent, from) => (s) => {
        feed();
        return Promise.resolve(box.resolve(intent, from, s));
      });
    }
    const settle = async () => {
      if (engine) for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const mod = systemModule(system);
    const players: Seat[] = [
      { seat: 0, player: "p0" },
      { seat: 1, player: "p1" },
    ];
    for (const p of players)
      send(
        {
          type: "player/join",
          player: { id: p.player, name: `Bot ${p.seat + 1}`, color: COLORS[p.seat]!, seat: p.seat },
        },
        p.player,
      );
    send({ type: "game/system", system }, "p0");
    await settle();
    send({ type: "layout/set", layout: mod.layout(host.current.table) }, "p0");
    const mission = mod.missions?.[0];
    if (mission) {
      const { zones, objectives } = mission.setup(host.current.table);
      send({ type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives }, "p0");
    }
    await settle();
    const ranked = (gameModule(system)?.system.unitShape.kind ?? "") === "ranked";
    for (const p of players) {
      const units = mod
        .sample(opts.mirror ?? (p.seat === 1 ? 1 : 0))
        .units.map((u) =>
          ranked && !u.files
            ? { ...u, files: Math.min(u.models.length, u.models.length >= 10 ? 5 : u.models.length) }
            : u,
        );
      for (const i of spawnIntents(host.current, p.player, units, `${p.player}-${seed}`, "sample"))
        send(i, p.player);
      await settle();
    }
    for (const u of Object.values(host.current.units))
      if (u.status?.reserves) send({ type: "unit/reserve", id: u.id, reserve: false, moves: [] }, u.owner);
    if (opts.first !== undefined) send({ type: "turn/first", seat: opts.first }, "p0");
    await settle();
    if (errors.length) throw new Error(errors[0]);
    const start = host.current;
    const policies = makePolicies(start);
    const missionNow = missionOf(start);
    let scoresDue = true;
    let stuck = 0;
    let shownRound = -1;
    // One unit's go that never ends is a bot stuck in a loop (UX 351): moves in a row with the same unit acting.
    let loopMark = "";
    let loopRun = 0;
    for (; result.steps < maxSteps; result.steps++) {
      clock++;
      const state = host.current;
      if (TRACE && state.turn.round !== shownRound) {
        shownRound = state.turn.round;
        const side = (seat: number) => {
          const ids = Object.values(state.players)
            .filter((p) => p.seat === seat)
            .map((p) => p.id);
          const vp = ids.reduce((a, id) => a + (state.resources[id]?.VP ?? 0), 0);
          const units = Object.values(state.units)
            .filter((u) => ids.includes(u.owner))
            .map((u) => {
              const ms = u.modelIds.map((id) => state.models[id]!).filter((m) => m && !m.destroyed);
              if (!ms.length) return `${u.name}✝`;
              const x = ms.reduce((a, m) => a + m.position.x, 0) / ms.length;
              const y = ms.reduce((a, m) => a + m.position.y, 0) / ms.length;
              return `${u.name}×${ms.length}@${x.toFixed(0)},${y.toFixed(0)}`;
            });
          return `vp${vp} ${units.join(" ")}`;
        };
        console.log(`== round ${shownRound} | s0 ${side(0)} | s1 ${side(1)}`);
      }
      if (state.turn.round > 0 && battleOver(state)) break;
      const record = host.log;
      // Every score the mission suggests, confirmed in full by the side it's for.
      if (missionNow && scoresDue) {
        const due = pendingScores(record, state, missionNow)[0];
        if (due) {
          const by = players.find((p) => p.seat === due.seat)!.player;
          send(
            {
              type: "score/confirm",
              key: due.key,
              seat: due.seat,
              round: due.round,
              vp: due.vp,
              why: due.why,
            },
            by,
          );
          await settle();
          continue;
        }
        scoresDue = false;
      }
      let move: BotMove | null = null;
      let mover = -1;
      for (const p of players) {
        const t0 = performance.now();
        const m = policies[p.seat]!.move(record, state, p);
        result.thinking[p.seat as 0 | 1] += performance.now() - t0;
        if (m && legal(record, state, m)) {
          move = m;
          mover = p.seat;
          break;
        }
      }
      if (!move) {
        if (++stuck > 3) throw new Error(`stuck in round ${state.turn.round}: neither side has a move`);
        await settle();
        continue;
      }
      stuck = 0;
      result.decisions[mover as 0 | 1]++;
      const before = lastSeq(record);

      if (TRACE)
        console.log(
          `r${state.turn.round} s${state.turn.activeSeat} p${state.turn.phase} ${move.as} ${JSON.stringify(move.intent).slice(0, 140)}`,
        );
      send(move.intent, move.as);
      await settle();
      if (move.then && !host.current.script?.waiting && legal(host.log, host.current, move.then)) {
        send(move.then.intent, move.then.as);
        await settle();
      }
      if (errors.length) throw new Error(errors[0]);
      if (lastSeq(host.log) === before && !host.current.script) {
        if (++stuck > 3) throw new Error(`the host dropped ${move.intent.type}`);
        continue;
      }
      if (!opts.blind) for (const p of policies) p.saw?.(host.current, move);
      const acting = actingUnits(host.current).map((u) => u.id);
      const mark = `${host.current.turn.round}:${host.current.turn.phase}:${acting.join()}`;
      loopRun = acting.length && mark === loopMark ? loopRun + 1 : 0;
      loopMark = mark;
      if (loopRun > 60)
        throw new Error(`looping: ${loopRun} moves in a row in one activation (${acting.join()})`);
      const now = host.current;
      if (
        now.turn.round !== state.turn.round ||
        now.turn.phase !== state.turn.phase ||
        now.turn.activeSeat !== state.turn.activeSeat
      )
        scoresDue = true;
      if (move.intent.type === "secret/reveal") scoresDue = true;
    }
    // The last scores, at the battle's end.
    if (missionNow)
      for (const due of pendingScores(host.log, host.current, missionNow)) {
        const by = players.find((p) => p.seat === due.seat)!.player;
        send(
          { type: "score/confirm", key: due.key, seat: due.seat, round: due.round, vp: due.vp, why: due.why },
          by,
        );
        await settle();
      }
    const end = host.current;
    result.record = host.log;
    result.finished = battleOver(end);
    result.rounds = end.turn.round;
    for (const s of end.scores ?? []) if (s.seat === 0 || s.seat === 1) result.vp[s.seat] += s.vp;
    for (const seat of sides(end))
      if (seat === 0 || seat === 1) result.kept[seat] = armyKept(start, end, seat);
    const [a, b] = result.vp;
    result.winner =
      a !== b
        ? a > b
          ? 0
          : 1
        : Math.abs(result.kept[0] - result.kept[1]) > 0.02
          ? result.kept[0] > result.kept[1]
            ? 0
            : 1
          : null;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (engine) {
      setIntentRouter(null);
      restoreSystems();
    }
    for (const owner of hookOwners) unregisterHooks(owner);
    host.leave();
  }
  return result;
}

/** The share of a side's army value still standing. */
function armyKept(start: GameState, end: GameState, seat: number): number {
  const was = armyValue(start, seat);
  return was > 0 ? armyValue(end, seat) / was : 0;
}
