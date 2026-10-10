import { DEFAULT_SYSTEM, lastSeq, type GameRecord, type GameState } from "../core";
import { listSystems } from "../core/content";
import { rankedReady } from "../core/ranked";
import { Session } from "../net/session";
import type { Transport } from "../net/transport";
import { systemModule } from "../systems";

/**
 * A host server (server/host.mjs): an always-on host that sits in a room in
 * place of a player's browser. It takes no seat; it resolves the players'
 * intents, rolls the dice and keeps the log, as a browser host would, and
 * keeps each game on disk so a restart (or a room everyone left) picks up
 * where it was.
 *
 * It hosts the built-in game systems only. A game that turns on a rules
 * package is handed to the players: the server leaves the room and the
 * players choose a new host among themselves (session.ts), one who holds the
 * package and runs it in their browser's sandbox. Running players' code on
 * the server would mean sandboxing it there. A ranked game is handed over the
 * same way, since its shared dice need a ranked player as host.
 */

/** Where a host server keeps its games between restarts. */
export interface RoomStore {
  load(room: string): GameRecord | null;
  save(room: string, record: GameRecord): void;
  remove(room: string): void;
  /** The rooms kept, with when each was last saved (ms). */
  list(): { room: string; savedAt: number }[];
}

export interface HostServerOptions {
  /** Joins a room, as this server. */
  transport(room: string): Transport;
  store?: RoomStore;
  /** At most this many rooms at once (50). */
  maxRooms?: number;
  /** Leave a room nobody has been in for this long (6 hours); it comes back when someone asks. */
  idleMs?: number;
  /** Forget a kept game untouched for this long (30 days). */
  keepMs?: number;
  /** Wait this long between saves of one room (2 s). */
  saveMs?: number;
  /** Stay this long after a game turns on a rules package (or ranked play), so the players get that event (3 s). */
  handOffMs?: number;
  now?: () => number;
}

/** What a player asks for when they open a room on the server. */
export interface OpenRequest {
  room: string;
  /** A built-in game system's id (40k when missing). */
  system?: string;
  /** Players a side (2 for 2 vs 2). */
  teamSize?: number;
}

export type OpenResult =
  { ok: true; room: string; resumed?: boolean } | { ok: false; status: number; error: string };

/** Room codes as the lobby makes them (8 characters), or as a player types one. */
const ROOM = /^[A-Za-z0-9_-]{4,64}$/;

/** A game the server is hosting now. */
interface Live {
  session: Session;
  /** When a player was last here (ms); now while anyone is. */
  seen: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * A game the server can't host: it names rules packages (the server never runs them), or it is ranked
 * (its shared dice are a handshake between the host and the other ranked player: core/sharedDice.ts).
 */
function needsABrowser(state: GameState): boolean {
  return (
    (state.packages?.packages.length ?? 0) > 0 ||
    state.packages?.system.builtIn === false ||
    rankedReady(state)
  );
}

export class HostServer {
  private readonly live = new Map<string, Live>();
  /** Rooms handed to the players' browsers; the server won't take them back. */
  private readonly handed = new Set<string>();
  private readonly opts: Required<Omit<HostServerOptions, "store">> & { store?: RoomStore };

  constructor(opts: HostServerOptions) {
    this.opts = {
      maxRooms: 50,
      idleMs: 6 * 3600_000,
      keepMs: 30 * 86400_000,
      saveMs: 2000,
      handOffMs: 3000,
      now: Date.now,
      ...opts,
    };
  }

  /** The rooms hosted now. */
  get rooms(): string[] {
    return [...this.live.keys()];
  }

  /** The session hosting a room now, if any (for tests and status). */
  session(room: string): Session | undefined {
    return this.live.get(room)?.session;
  }

  /** Host a new game in `room`. A room the server already keeps is woken instead. */
  open(req: OpenRequest): OpenResult {
    const { room } = req;
    if (!ROOM.test(room)) return { ok: false, status: 400, error: "bad room code" };
    if (this.live.has(room) || this.opts.store?.load(room)) return this.wake(room);
    if (this.handed.has(room)) return { ok: false, status: 409, error: "the players host this room now" };
    const system = req.system ?? DEFAULT_SYSTEM;
    if (!listSystems().some((s) => s.id === system))
      return { ok: false, status: 400, error: "this server hosts the built-in games only" };
    if (this.live.size >= this.opts.maxRooms) return { ok: false, status: 503, error: "the server is full" };
    const session = this.host(room);
    // What a browser host does as it opens a room (store.ts start, Lobby host).
    if (system !== DEFAULT_SYSTEM) session.dispatch({ type: "game/system", system });
    const mod = systemModule(system);
    session.dispatch({ type: "layout/set", layout: mod.layout(session.current.table) });
    const mission = mod.missions?.[0];
    if (mission) {
      const { zones, objectives } = mission.setup(session.current.table);
      session.dispatch({
        type: "mission/set",
        mission: { id: mission.id, name: mission.name },
        zones,
        objectives,
      });
    }
    const teamSize = Math.round(Number(req.teamSize));
    if (teamSize > 1 && teamSize <= 4) session.dispatch({ type: "settings/set", settings: { teamSize } });
    return { ok: true, room };
  }

  /**
   * Make sure the server is in `room`, if it hosts it: a player coming back to a
   * room the server left while it stood empty (or before a restart) brings it back.
   */
  wake(room: string): OpenResult {
    if (!ROOM.test(room)) return { ok: false, status: 400, error: "bad room code" };
    const live = this.live.get(room);
    if (live) {
      live.seen = this.opts.now();
      return { ok: true, room };
    }
    if (this.handed.has(room)) return { ok: false, status: 409, error: "the players host this room now" };
    const record = this.opts.store?.load(room);
    if (!record) return { ok: false, status: 404, error: "no such room" };
    if (this.live.size >= this.opts.maxRooms) return { ok: false, status: 503, error: "the server is full" };
    this.host(room, record);
    return { ok: true, room, resumed: true };
  }

  /** Whether this server hosts `room` (now, or kept for when someone comes back). */
  hosts(room: string): boolean {
    return ROOM.test(room) && (this.live.has(room) || !!this.opts.store?.load(room));
  }

  /** Leave rooms nobody has been in for a while, and forget games untouched for longer. */
  sweep(): void {
    const now = this.opts.now();
    for (const [room, live] of this.live) {
      if (live.session.status.peers.length) live.seen = now;
      else if (now - live.seen > this.opts.idleMs) this.close(room);
    }
    const store = this.opts.store;
    if (!store) return;
    for (const { room, savedAt } of store.list())
      if (!this.live.has(room) && now - savedAt > this.opts.keepMs) store.remove(room);
  }

  /** Leave every room, saving each game first. */
  stop(): void {
    for (const room of [...this.live.keys()]) this.close(room);
  }

  private host(room: string, record?: GameRecord): Session {
    const mine = () => this.live.get(room)?.session === session;
    const session: Session = new Session({
      transport: this.opts.transport(room),
      role: "host",
      ...(record ? { record, resumed: true } : {}),
      // The server can never run a rules package, so it never takes a room back once handed on.
      ready: (state) => !needsABrowser(state),
      onChange: (state) => {
        if (!mine()) return;
        // The event is still on its way to the players: leave once they have it.
        if (needsABrowser(state)) return void setTimeout(() => this.handOff(room), this.opts.handOffMs);
        this.saveSoon(room);
      },
      onNet: (status) => {
        if (mine() && status.peers.length) this.live.get(room)!.seen = this.opts.now();
      },
    });
    this.live.set(room, { session, seen: this.opts.now(), saveTimer: null });
    if (needsABrowser(session.current)) setTimeout(() => this.handOff(room), this.opts.handOffMs);
    return session;
  }

  private saveSoon(room: string): void {
    const live = this.live.get(room);
    if (!live || live.saveTimer || !this.opts.store) return;
    live.saveTimer = setTimeout(() => {
      live.saveTimer = null;
      if (this.live.get(room) === live) this.opts.store!.save(room, live.session.log);
    }, this.opts.saveMs);
  }

  /** The game needs a rules package or is ranked: leave, so a player's browser takes over as host. */
  private handOff(room: string): void {
    const live = this.live.get(room);
    if (!live || !needsABrowser(live.session.current)) return;
    this.handed.add(room);
    this.live.delete(room);
    if (live.saveTimer) clearTimeout(live.saveTimer);
    this.opts.store?.remove(room);
    live.session.leave();
  }

  private close(room: string): void {
    const live = this.live.get(room);
    if (!live) return;
    this.live.delete(room);
    if (live.saveTimer) clearTimeout(live.saveTimer);
    if (lastSeq(live.session.log) > 0) this.opts.store?.save(room, live.session.log);
    live.session.leave();
  }
}
