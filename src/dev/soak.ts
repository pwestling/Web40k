/**
 * Development-only: the soak bot playing in the real app, for long-session
 * memory and leak checks (scripts/soak-browser.mjs). Unlike `pnpm soak`
 * (loopback peers in Node, checking the rules), this drives the app's own
 * online game: two tabs over a relay, each playing its own side, so WebRTC,
 * figure sharing, voice, the table, the dice tray, sound and ambience all
 * run, painted figures are on, and a rules package runs in the sandbox.
 * The script starts game after game in new rooms.
 */
import { sha256Hex, type PlayerId } from "../core";
import { currentSlot } from "../core/content/turn";
import { seededRng } from "../sandbox/protocol";
import { battleOver, freeMoves, legal, waitingOn, type BotContext, type Kept } from "../soak/bot";
import { useLibrary } from "../packages/library";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { systemOf } from "../core/content/turn";
import { micOff, micOn, setMode, useVoice } from "../voice/voice";
import secondWind from "../../examples/packages/second-wind.js?raw";
import { perf } from "./perf";
import { gameId } from "../campaign/book";
import { putNote, useNotes } from "../replay/notes";

export const SOAK_SYSTEMS = ["forty-k-11", "tow-hand", "conquest-hand", "fsd-1.7"];

let ctx: BotContext = { rng: seededRng(1), kept: new Map() as Kept, idle: 0 };
let mark = "";
let timer: ReturnType<typeof setTimeout> | null = null;
const stats = {
  games: 0,
  moves: 0,
  errors: [] as string[],
  system: "",
  lastMoveAt: 0,
  reviewed: 0,
};

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const me = () => useStore.getState().session?.selfId ?? "";

const PACKAGE = {
  id: "example.second-wind",
  name: "Second Wind (example)",
  version: "1.0.0",
  hash: sha256Hex(secondWind),
  bytes: new TextEncoder().encode(secondWind).length,
};

/** The example rules package in this browser's library, trusted, so a game can run it in the sandbox. */
async function addPackage() {
  const lib = useLibrary.getState();
  await lib.load();
  if (!useLibrary.getState().packages[PACKAGE.hash]) await lib.add(new TextEncoder().encode(secondWind));
  useLibrary.getState().trust(PACKAGE.hash, true);
}

/** One bot move for this tab's player. False when there is none. */
function step(): boolean {
  const { game: state, record, dispatch } = useStore.getState();
  if (state.turn.round > 0 && battleOver(state)) return false;
  const self = me();
  const waiting = waitingOn(record, state, ctx);
  for (const move of waiting ? waiting.moves : freeMoves(state, ctx)) {
    if (move.as !== self || !legal(record, state, move)) continue;
    try {
      dispatch(move.intent, move.as as PlayerId);
    } catch (e) {
      stats.errors.push(`${move.intent.type}: ${e instanceof Error ? e.message : String(e)}`);
    }
    stats.moves++;
    stats.lastMoveAt = Date.now();
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
  return false;
}

export const soakBrowser = {
  /** Host or join an online game of `system` in `roomId` (the relay comes from ?signal=). */
  async join(role: "host" | "client", roomId: string, system: string, n: number) {
    soakBrowser.stop();
    stats.system = system;
    stats.games++;
    ctx = { rng: seededRng(n * 2 + (role === "host" ? 1 : 2)), kept: new Map() as Kept, idle: 0 };
    mark = "";
    await addPackage();
    useStore
      .getState()
      .start({ role, mode: "online", roomId, name: role === "host" ? "Soak A" : "Soak B", system });
    while (!useStore.getState().session) await frame();
    // Chess clocks on, with round and game limits, so their ticking and time calls run too.
    if (role === "host")
      useStore.getState().dispatch({
        type: "settings/set",
        settings: { clock: { minutes: 60, roundMinutes: 15, gameMinutes: 150 } },
      });
    if (role === "host" && system === "tow-hand")
      useStore.getState().dispatch({
        type: "game/packages",
        app: "soak",
        system: { id: system, builtIn: true },
        packages: [PACKAGE],
      });
  },
  /** Seated (the guest once it has found the host and sat down). */
  seated() {
    const { game } = useStore.getState();
    return game.players[me()]?.seat !== undefined;
  },
  /** Both sides seated, as the host sees it. */
  full() {
    return Object.values(useStore.getState().game.players).filter((p) => p.seat !== undefined).length >= 2;
  },
  /** This tab's sample army on the table, painted 200k sculpts with 2K textures, mic open. */
  async deploy() {
    const self = me();
    const { game, dispatch } = useStore.getState();
    const seat = game.players[self]!.seat!;
    const ranked = systemOf(game).unitShape.kind === "ranked";
    const units = systemModule(game.system ?? undefined)
      .sample(seat === 0 ? 0 : 1)
      .units.map((u) => (ranked ? { ...u, files: Math.min(u.models.length, 5) } : u));
    for (const intent of spawnIntents(game, self, units, `${self.slice(0, 6)}-soak${stats.games}`))
      dispatch(intent, self);
    await frame();
    for (const u of Object.values(useStore.getState().game.units))
      if (u.owner === self && u.status?.reserves)
        dispatch({ type: "unit/reserve", id: u.id, reserve: false, moves: [] }, self);
    await perf.dress(200_000, false, true, self);
    setMode("open");
    await micOn().catch((e: unknown) => stats.errors.push(`mic: ${String(e)}`));
  },
  /** Play this tab's side, a move every `everyMs`, until stop(). */
  play(everyMs = 300) {
    soakBrowser.stop();
    stats.lastMoveAt = Date.now();
    const tick = () => {
      step();
      timer = setTimeout(tick, everyMs);
    };
    timer = setTimeout(tick, everyMs);
  },
  stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  },
  leave() {
    soakBrowser.stop();
    micOff();
    useStore.getState().session?.leave();
    useStore.setState({ session: null, role: "host", scrub: null });
  },
  /**
   * After a game: open its replay, annotate it (notes with arrows and areas,
   * as a coach would) and step through it, then back to the lobby.
   */
  async review(notes = 12, stepMs = 400) {
    const record = useStore.getState().record;
    soakBrowser.leave();
    useStore.getState().openReplay(record);
    const id = gameId(record);
    for (let i = 0; i < 300 && useNotes.getState().game !== id; i++) await frame();
    const seqs = record.events.map((e) => e.seq);
    const at = (k: number) => seqs[Math.floor((k / notes) * (seqs.length - 1))]!;
    const { width, depth } = useStore.getState().game.table;
    for (let k = 0; k < notes; k++) {
      const p = () => ({ x: Math.random() * width, y: Math.random() * depth });
      putNote({
        id: `soak-${stats.games}-${k}`,
        seq: at(k),
        by: "Soak",
        color: "#e11d48",
        text: `Note ${k}: what went wrong here`,
        marks: [
          { kind: "arrow", from: p(), to: p() },
          { kind: "area", at: p(), radius: 3 },
        ],
        at: Date.now(),
      });
    }
    for (let k = 0; k < notes; k++) {
      useStore.getState().setScrub(at(k));
      await new Promise((r) => setTimeout(r, stepMs));
    }
    stats.reviewed++;
    soakBrowser.leave();
  },
  stats() {
    const { record, game } = useStore.getState();
    return {
      ...stats,
      errors: stats.errors.slice(-5),
      errorCount: stats.errors.length,
      events: record.events.length,
      round: game.turn.round,
      over: game.turn.round > 0 && battleOver(game),
      quietMs: Date.now() - stats.lastMoveAt,
      voice: (({ mic, live, error, peers }) => ({ mic, live, error, peers: Object.keys(peers).length }))(
        useVoice.getState(),
      ),
    };
  },
};
