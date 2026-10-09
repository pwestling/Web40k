import { useSolo } from "./bot/solo";
import type { Level } from "./bot/player";
import { create } from "zustand";
import { useLibrary } from "./packages/library";
import {
  createInitialState,
  createRecord,
  DEFAULT_SYSTEM,
  stateAt,
  type GameRecord,
  type GameState,
  type Intent,
  type Player,
  type PlayerId,
  type Rng,
  type UnitId,
} from "./core";
import { broadcastTransport } from "./net/broadcast";
import { createLoopbackNetwork } from "./net/loopback";
import { Session, type NetStatus, type Role } from "./net/session";
import type { trysteroTransport as TrysteroTransport } from "./net/trystero";
import { systemModule } from "./systems";
import { replayIntro } from "./ui/highlights";

let trystero: typeof TrysteroTransport | null = null;
/** The WebRTC transport's chunk; the lobby calls this when idle so an online game starts at once. */
export const loadTrystero = () =>
  import("./net/trystero").then((m) => {
    trystero = m.trysteroTransport;
  });

/** Side colours, told apart with colour blindness too (blue, orange, teal, yellow; #25), each with a shape (ui/sides.ts). */
const COLORS = ["#3b82f6", "#f97316", "#2dd4bf", "#fde047"];

/** "eye" looks from a model's eye line (see `eye`). */
type View = "3d" | "top" | "eye";

/**
 * How peers reach each other. "online" is WebRTC between browsers;
 * "local" links tabs of the same browser; "hotseat" is one screen, both sides.
 */
export type Mode = "online" | "local" | "hotseat";

interface StartOptions {
  role: Role;
  mode: Mode;
  roomId?: string;
  name: string;
  /** Resume a saved game (host only). */
  record?: GameRecord;
  /** Game system for a new game (host only); 40k when missing. */
  system?: string;
  /** The host's dice (play by mail draws them from both players' seeds: src/mail/dice.ts). */
  rng?: Rng;
  /** Told of every intent the host resolves, in order (play by mail records them). */
  onIntent?: (intent: Intent, by: PlayerId) => void;
  /** Watch `record` (or the host's) together as a replay: nobody plays, nothing is added to it. */
  review?: boolean;
  /** An exhibition table (#64): an online room where this screen seats both sides, for the computer to play. */
  exhibition?: boolean;
}

/**
 * A play-by-mail game on this screen (src/mail): the side this device plays,
 * the first event of its current stretch (nothing before it can be undone),
 * and whether it's waiting for the opponent's file (nothing can be done).
 */
interface MailSeat {
  seat: number;
  floor: number;
  locked: boolean;
}

/** The attack panel's choices before anything is rolled. Local to each player. */
export interface AttackDraft {
  attackerId: UnitId;
  kind: "ranged" | "melee";
  weaponId?: string;
  targetId?: UnitId;
  /** Waiting for a click on an enemy unit. */
  picking: boolean;
  /** The game system action this sets up (generic systems), e.g. "fire". */
  action?: string;
  /** "Shoot everything at…" (UX 398): every weapon that can, at one target. */
  all?: boolean;
}

interface Store {
  game: GameState;
  /** The event log: source of truth for history, undo and replays. */
  record: GameRecord;
  session: Session | null;
  role: Role | null;
  mode: Mode;
  roomId: string | null;
  /** Camera mode. Local to each player; never synced. */
  view: View;
  selected: UnitId | null;
  draft: AttackDraft | null;
  /** Replay viewer: show the table as it stood after this seq (null = live). */
  scrub: number | null;
  /** A review room: a replay watched (and annotated) together, online (src/replay/review.ts). */
  review: boolean;
  /** Terrain editor open: terrain and objectives can be dragged and changed. */
  editing: boolean;
  selectedTerrain: string | null;
  /** See-through terrain, to find models inside ruins. */
  xray: boolean;
  /** Show what this unit can see. */
  losFrom: UnitId | null;
  /** Model whose eye the "eye" view looks from, and where it looks. */
  eye: { modelId: string; at: { x: number; y: number; z: number } } | null;
  /** Unit under the mouse, for line-of-sight focus. */
  hoverUnit: UnitId | null;
  /** Models a panel points at (a wound-order chip under the mouse), ringed on the table. */
  hoverModels: string[] | null;
  /** Unit name plates over the table. */
  plates: boolean;
  /** Ruler tool: drags on the table measure instead of moving. */
  measuring: boolean;
  /** Unit whose move and weapon ranges are drawn around its models. */
  ranges: UnitId | null;
  /** Weapon whose range Ranges shows (default: the unit's longest). */
  rangeWeapon: string | null;
  /** Connection state: who is host, who is connected, whether the room is choosing a new host. */
  net: NetStatus | null;
  /** Rules packages (hashes) this player chose to play without in this room. */
  packagesWaived: Record<string, true>;
  /** Try to take a seat again (after the player has sorted out the game's rules packages). */
  seatAgain: (() => void) | null;
  /** Director camera: follows the latest action (moves, shots, charges). */
  director: boolean;
  /** Front, flank and rear arcs of the selected (and hovered) regiment. */
  arcs: boolean;
  /** The after-game stats screen: open, closed, or null to open it on its own when the battle ends. */
  stats: boolean | null;
  /** A rare outcome being celebrated on the table (PX-2): the unit, its title and line. Display only. */
  moment: { unitId: string; title: string; line: string; lucky: boolean; at: number } | null;
  set(
    patch: Partial<
      Pick<
        Store,
        | "editing"
        | "selectedTerrain"
        | "xray"
        | "losFrom"
        | "eye"
        | "view"
        | "hoverUnit"
        | "hoverModels"
        | "plates"
        | "measuring"
        | "ranges"
        | "rangeWeapon"
        | "director"
        | "arcs"
        | "stats"
        | "moment"
      >
    >,
  ): void;
  setView(view: View): void;
  /** Bumped to put the camera back to its starting position. */
  cameraReset: number;
  resetView(): void;
  select(id: UnitId | null): void;
  setDraft(draft: AttackDraft | null): void;
  setScrub(seq: number | null): void;
  start(options: StartOptions): void;
  /** Open a replay file without joining any game. */
  openReplay(record: GameRecord): void;
  /** Send an intent; in hotseat the host acts as `as` (default: the player whose turn it is). */
  dispatch(intent: Intent, as?: PlayerId): void;
  /** Play by mail: this screen plays one side of a hotseat session. */
  mail: MailSeat | null;
  /** An exhibition table (#64): this screen seats both sides of an online room. */
  exhibition: boolean;
}

/** The delay a watcher asked for in the page's link (?delay=, seconds; see broadcast/broadcast.ts). */
function spectatorDelayMs(): number {
  if (typeof location === "undefined") return 0;
  const s = Number(new URLSearchParams(location.search).get("delay"));
  return Number.isFinite(s) && s > 0 ? Math.min(600, s) * 1000 : 0;
}

const SAVE_KEY = "open-battle:last-game";

export interface SavedGame {
  mode: Mode;
  roomId: string | null;
  record: GameRecord;
  savedAt: number;
  /** Who the computer played (#45), so Resume says so and plays it again (UX 439). */
  computer?: { level: Level; seat: number };
}

/** The computer's side in this screen's game, if it plays one. */
function computerIn(session: Session | null): SavedGame["computer"] {
  const { level, seat, both, session: its } = useSolo.getState();
  return level && !both && session && its === session ? { level, seat } : undefined;
}

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedGame) : null;
  } catch {
    return null;
  }
}

/** What a peer keeps per room so a reload can rejoin: the log it holds and the player it was. */
interface SavedRoom {
  record: GameRecord;
  playerId?: string;
  /** What this tab was in the room, so a reload rejoins the same way. */
  role?: Role;
}

const roomKey = (roomId: string) => `open-battle:room:${roomId}`;

export function loadRoom(roomId: string): SavedRoom | null {
  try {
    const raw = sessionStorage.getItem(roomKey(roomId));
    return raw ? (JSON.parse(raw) as SavedRoom) : null;
  } catch {
    return null;
  }
}

/**
 * The seat this browser last had in a room, kept beyond the tab (sessionStorage is per tab), so
 * reopening the invite link in a new tab finds its player again (UX 216).
 */
const seatKey = (roomId: string) => `open-battle:seat:${roomId}`;

function deviceSeat(roomId: string): string | undefined {
  try {
    return localStorage.getItem(seatKey(roomId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveRoom(roomId: string, record: GameRecord, seatedAs: string | undefined, role: Role) {
  try {
    if (seatedAs && localStorage.getItem(seatKey(roomId)) !== seatedAs)
      localStorage.setItem(seatKey(roomId), seatedAs);
    // Remember the player we are once we have a seat; until then keep the old one.
    const playerId = seatedAs ?? loadRoom(roomId)?.playerId;
    sessionStorage.setItem(
      roomKey(roomId),
      JSON.stringify({ record, role, ...(playerId ? { playerId } : {}) }),
    );
  } catch {
    // Storage full or blocked: a reload rejoins from scratch.
  }
}

/** Save what this screen has of the game now, whatever its role (the crash screen: src/ui/Crash.tsx). */
export function saveNow(): void {
  const { record, mode, session, roomId } = useStore.getState();
  if (!session || !record.events.length || !mode) return;
  saveGame({ mode, roomId, record, savedAt: Date.now(), computer: computerIn(session) });
}

function saveGame(game: SavedGame) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch {
    // Storage full or blocked: the game goes on, it just can't be resumed.
  }
}

const HOTSEAT_PLAYERS: Player[] = [
  { id: "p1", name: "Player 1", color: COLORS[0]!, seat: 0 },
  { id: "p2", name: "Player 2", color: COLORS[1]!, seat: 1 },
];

/**
 * A seat played from the host's own screen (a hotseat side, or the computer's in an exhibition):
 * no peer of its own, so never "reconnecting" (UX 442).
 */
export const screenSeat = (id: string): boolean => HOTSEAT_PLAYERS.some((p) => p.id === id);

export const useStore = create<Store>((set, get) => ({
  game: createInitialState(),
  record: createRecord(),
  session: null,
  role: null,
  mode: "online",
  roomId: null,
  view: "3d",
  selected: null,
  draft: null,
  scrub: null,
  review: false,
  editing: false,
  selectedTerrain: null,
  xray: false,
  losFrom: null,
  hoverUnit: null,
  hoverModels: null,
  plates: true,
  measuring: false,
  ranges: null,
  rangeWeapon: null,
  director: false,
  stats: null,
  moment: null,
  net: null,
  packagesWaived: {},
  seatAgain: null,
  mail: null,
  exhibition: false,
  arcs: true,
  eye: null,
  set: (patch) => set(patch),
  setView: (view) => set({ view, ...(view === "eye" ? {} : { eye: null }) }),
  cameraReset: 0,
  resetView: () =>
    set((s) => ({ view: s.view === "eye" ? "3d" : s.view, eye: null, cameraReset: s.cameraReset + 1 })),
  // Picking another unit closes an open action for the last one (UX 111).
  select: (selected) =>
    set((s) => ({ selected, draft: s.draft && s.draft.attackerId !== selected ? null : s.draft })),
  setDraft: (draft) => set({ draft }),
  setScrub: (scrub) => set({ scrub }),

  start(options) {
    const { role: asked, mode, roomId, name, record, system, rng, onIntent } = options;
    const review = !!options.review;
    // In a review room only the host's session is a host (it shows the record); everyone watches.
    const role: Role = review && asked !== "host" ? "spectator" : asked;
    // WebRTC (Trystero) loads on demand, and usually already has: the front door prefetches it.
    if (mode !== "hotseat" && mode !== "local" && !trystero) {
      void loadTrystero().then(() => get().start(options));
      return;
    }
    get().session?.leave();
    const transport =
      mode === "hotseat"
        ? createLoopbackNetwork().connect("solo")
        : mode === "local"
          ? broadcastTransport(roomId!)
          : trystero!(roomId!);
    // A client coming back to a room picks up the log it saved there, and asks only for what it missed.
    const room = mode === "hotseat" || !roomId ? null : loadRoom(roomId);
    const resumed = role === "host" && !!record && mode !== "hotseat";
    let seated = role === "spectator" || review;
    const session: Session = new Session({
      transport,
      role,
      record: record ?? (role === "client" ? room?.record : undefined),
      resumed,
      ...(rng ? { rng } : {}),
      ...(onIntent ? { onIntent } : {}),
      // A watcher behind the game (?delay=, useBroadcast): the host holds its events back that long.
      ...(role === "spectator" ? { delay: spectatorDelayMs() } : {}),
      // A peer missing one of the game's rules packages can't host it.
      frozen: review,
      ready: (state) =>
        (state.packages?.packages ?? []).every((p) => !!useLibrary.getState().packages[p.hash]),
      onChange: (game, rec) => {
        // A session that was replaced (left) may still call back; ignore it.
        if (get().session !== session) return;
        set({ game, record: rec });
        const current = session?.status.role ?? role;
        // A review shows an old record: it is never this device's game to resume.
        if (review) return;
        if (current === "host")
          saveGame({
            mode,
            roomId: roomId ?? null,
            record: rec,
            savedAt: Date.now(),
            computer: computerIn(session),
          });
        if (roomId && mode !== "hotseat")
          saveRoom(
            roomId,
            rec,
            session && game.players[session.selfId] ? session.selfId : undefined,
            current,
          );
        takeSeat();
      },
      onNet: (status) => {
        if (get().session !== session) return;
        set({ net: status, role: review ? "spectator" : status.role });
        takeSeat();
      },
    });
    set({
      session,
      mode,
      roomId: roomId ?? null,
      game: session.current,
      record: session.log,
      net: session.status,
      selected: null,
      draft: null,
      review,
      role: review ? "spectator" : role,
      // A review opens where the battle starts, as a replay does.
      scrub: review && record ? replayIntro(record).startSeq : null,
      // Spectators start with the camera following the action.
      director: role === "spectator" || review,
      stats: null,
      moment: null,
      packagesWaived: {},
      seatAgain: () => takeSeat(),
      mail: null,
      exhibition: !!options.exhibition && role === "host",
    });

    /**
     * Once there is a host and a game: take back our old seat (a reload or a
     * dropped connection gives us a new peer id), or a free one.
     */
    function takeSeat() {
      if (seated || mode === "hotseat" || !session || get().session !== session) return;
      const status = session.status;
      if (status.role === "host" ? false : status.hostId === null) return;
      const game = session.current;
      if (game.seq === 0 && status.role !== "host") return;
      // Sit down only with the game's rules, or having chosen to play without them (the package card).
      if (status.role !== "host") {
        const lib = useLibrary.getState();
        if (!lib.loaded) return;
        const waived = get().packagesWaived;
        if ((game.packages?.packages ?? []).some((p) => !lib.packages[p.hash] && !waived[p.hash])) return;
      }
      const players = Object.values(game.players);
      if (players.some((p) => p.id === session.selfId)) {
        seated = true;
        return;
      }
      // This tab's seat, else this browser's (a new tab on the same invite), else a resumed host's own.
      const mine =
        room?.playerId ??
        (roomId ? deviceSeat(roomId) : undefined) ??
        (resumed ? players.find((p) => p.seat === 0)?.id : undefined);
      seated = true;
      // This tab's own seat comes back to it even if its old connection still looks present: a reloaded
      // tab can linger in the peer list for a while, and the host already shows that player as away (UX 216).
      // Another tab's seat is taken only once that player has gone, so two tabs can still play each other.
      if (mine && game.players[mine] && (room?.playerId === mine || !status.peers.includes(mine))) {
        session.dispatch({ type: "player/claim", player: mine });
        return;
      }
      if (status.role === "host") return;
      // Sides fill up to the team size (2v2: two players each), the emptier side first.
      const size = game.settings.teamSize ?? 1;
      const count = (seat: number) => players.filter((p) => p.seat === seat).length;
      if (count(0) >= size && count(1) >= size) return;
      const seat = count(0) >= size ? 1 : count(1) >= size ? 0 : count(1) < count(0) ? 1 : 0;
      session.dispatch({
        type: "player/join",
        player: { id: session.selfId, name, color: COLORS[seat + 2 * count(seat)] ?? COLORS[seat]!, seat },
      });
    }

    if (role !== "host") {
      takeSeat();
      return;
    }
    // A hotseat game picked up again (play by mail) already has its players.
    if (record && mode === "hotseat") return;
    if (record) {
      // A resumed host first finds out whether the room has moved on without it
      // (it may stand down), then takes its seat back.
      setTimeout(takeSeat, 1500);
      return;
    }
    seated = true;
    if (mode === "hotseat" || options.exhibition) {
      for (const p of HOTSEAT_PLAYERS) session.dispatch({ type: "player/join", player: p }, p.id);
    } else {
      session.dispatch({
        type: "player/join",
        player: { id: session.selfId, name, color: COLORS[0]!, seat: 0 },
      });
    }
    if (system && system !== DEFAULT_SYSTEM) session.dispatch({ type: "game/system", system });
    session.dispatch({ type: "layout/set", layout: systemModule(system).layout(session.current.table) });
  },

  openReplay(record) {
    get().session?.leave();
    // Replays open where the battle starts, not on the empty deployment table.
    const scrub = replayIntro(record).startSeq;
    set({
      session: null,
      role: "spectator",
      review: false,
      record,
      // The game as it ended, so what it needs (its rules packages) is loaded to watch it.
      game: stateAt(record),
      scrub,
      selected: null,
      draft: null,
      director: true,
      stats: null,
      moment: null,
    });
  },

  dispatch(intent, as) {
    const { session, mode, game, mail } = get();
    if (!session) return;
    if (mail) {
      // Play by mail: nothing while waiting for their file, and no taking back what they've seen.
      if (mail.locked) return;
      if (intent.type === "undo" && [intent.seq, ...(intent.also ?? [])].some((s) => s <= mail.floor)) return;
      const me = Object.values(game.players).find((p) => p.seat === mail.seat);
      session.dispatch(intent, as ?? me?.id);
      return;
    }
    if (mode === "hotseat" || get().exhibition) {
      const active = Object.values(game.players).find((p) => p.seat === game.turn.activeSeat);
      session.dispatch(intent, as ?? active?.id);
    } else session.dispatch(intent);
  },
}));

/** Who this browser plays as, for permissions. Hotseat controls everything. */
/** A player who has joined a room but isn't seated yet (sorting out rules packages, or still connecting). */
export function useJoining(): boolean {
  return useStore(
    (s) =>
      s.mode !== "hotseat" &&
      s.role === "client" &&
      !!s.session &&
      s.game.players[s.session.selfId]?.seat === undefined,
  );
}

export function useCanControl(): (owner: PlayerId) => boolean {
  const mode = useStore((s) => s.mode);
  const role = useStore((s) => s.role);
  const selfId = useStore((s) => s.session?.selfId);
  const mail = useStore((s) => s.mail);
  const seatOf = useStore((s) => s.game.players);
  const session = useStore((s) => s.session);
  const solo = useSolo((s) => (s.level && !s.paused && s.session === session ? s : null));
  if (mail) return (owner) => !mail.locked && seatOf[owner]?.seat === mail.seat;
  // Solo against the computer (#45): its side is its own, not yours to play (UX 347).
  if (solo) return (owner) => role !== "spectator" && !solo.both && seatOf[owner]?.seat !== solo.seat;
  return (owner) => role !== "spectator" && (mode === "hotseat" || owner === selfId);
}
