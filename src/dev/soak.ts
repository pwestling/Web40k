/**
 * Development-only: the soak bot playing in the real app, for long-session
 * memory and leak checks (scripts/soak-browser.mjs). Unlike `pnpm soak`
 * (loopback peers in Node, checking the rules), this drives the app's own
 * hotseat game, so the table renders, the dice tray rolls, sound and
 * ambience play, painted figures are on, and a rules package runs in the
 * sandbox. Game after game, in one tab.
 */
import { sha256Hex, type PlayerId } from "../core";
import { currentSlot } from "../core/content/turn";
import { seededRng } from "../sandbox/protocol";
import { battleOver, freeMoves, legal, waitingOn, type BotContext, type Kept } from "../soak/bot";
import { useLibrary } from "../packages/library";
import { useStore } from "../store";
import secondWind from "../../examples/packages/second-wind.js?raw";
import { perf } from "./perf";

const SYSTEMS = ["forty-k-11", "tow-hand", "conquest-hand", "fsd"];

let ctx: BotContext = { rng: seededRng(1), kept: new Map() as Kept, idle: 0 };
let mark = "";
let timer: ReturnType<typeof setTimeout> | null = null;
const stats = { games: 0, finished: 0, moves: 0, stuck: 0, errors: [] as string[], system: "" };

/** A fresh hotseat game of `system`: both sample armies, everything on the table, painted figures. */
async function newGame(n: number) {
  const system = SYSTEMS[n % SYSTEMS.length]!;
  stats.system = system;
  stats.games++;
  ctx = { rng: seededRng(n + 1), kept: new Map() as Kept, idle: 0 };
  await perf.setup(1, system);
  const { dispatch } = useStore.getState();
  for (const u of Object.values(useStore.getState().game.units))
    if (u.status?.reserves) dispatch({ type: "unit/reserve", id: u.id, reserve: false, moves: [] }, u.owner);
  // Painted 200k-triangle sculpts with 2K textures, as players would bring.
  await perf.dress(200_000, false, true);
  if (system === "tow-hand") await addPackage();
}

/** The example rules package, agreed by both seats, so it runs in the sandbox. */
async function addPackage() {
  const lib = useLibrary.getState();
  await lib.load();
  const bytes = new TextEncoder().encode(secondWind);
  await lib.add(bytes);
  const hash = sha256Hex(secondWind);
  useLibrary.getState().trust(hash, true);
  const ref = {
    id: "example.second-wind",
    name: "Second Wind (example)",
    version: "1.0.0",
    hash,
    bytes: bytes.length,
  };
  const { game, dispatch } = useStore.getState();
  const seats = Object.values(game.players).filter((p) => p.seat !== undefined);
  dispatch({ type: "packages/propose", packages: [ref] }, seats[0]!.id);
  for (const p of seats.slice(1)) dispatch({ type: "packages/accept" }, p.id);
  dispatch(
    {
      type: "game/packages",
      app: "soak",
      system: { id: game.system!, builtIn: true },
      packages: [ref],
      agreed: seats.map((p) => p.id),
    },
    seats[0]!.id,
  );
}

/** One bot move. False when the game is over or nothing legal is left. */
function step(): boolean {
  const { game: state, record, dispatch } = useStore.getState();
  if (state.turn.round > 0 && battleOver(state)) {
    stats.finished++;
    return false;
  }
  const waiting = waitingOn(record, state, ctx);
  for (const move of waiting ? waiting.moves : freeMoves(state, ctx)) {
    if (!legal(record, state, move)) continue;
    try {
      dispatch(move.intent, move.as as PlayerId);
    } catch (e) {
      stats.errors.push(`${move.intent.type}: ${e instanceof Error ? e.message : String(e)}`);
    }
    stats.moves++;
    const s = useStore.getState().game;
    // As in src/soak/run.ts: moves since the phase or activation last changed, so the bot moves the game on.
    const acting = Object.values(s.units)
      .filter((u) => u.status?.acting)
      .map((u) => u.id)
      .join();
    const m = `${s.turn.round}:${s.turn.activeSeat}:${currentSlot(s)?.id}:${s.turn.phase}:${acting}`;
    ctx.idle = m === mark ? ctx.idle + 1 : 0;
    mark = m;
    return true;
  }
  stats.stuck++;
  return false;
}

export const soakBrowser = {
  /** Play game after game, a move every `everyMs`, until stop(). */
  async start(everyMs = 300) {
    let n = 0;
    await newGame(n);
    const tick = async () => {
      if (!step()) await newGame(++n);
      timer = setTimeout(() => void tick(), everyMs);
    };
    timer = setTimeout(() => void tick(), everyMs);
  },
  stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  },
  stats() {
    const { record, game } = useStore.getState();
    return {
      ...stats,
      errors: stats.errors.slice(-5),
      errorCount: stats.errors.length,
      events: record.events.length,
      round: game.turn.round,
    };
  },
};
