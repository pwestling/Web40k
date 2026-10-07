import { create } from "zustand";
import { useLibrary } from "./packages/library";
import {
  createInitialState,
  createRecord,
  DEFAULT_SYSTEM,
  type GameRecord,
  type GameState,
  type Intent,
  type Player,
  type PlayerId,
  type UnitId,
} from "./core";
import { broadcastTransport } from "./net/broadcast";
import { createLoopbackNetwork } from "./net/loopback";
import { Session, type NetStatus, type Role } from "./net/session";
import { trysteroTransport } from "./net/trystero";
import { systemModule } from "./systems";
import { replayIntro } from "./ui/highlights";

export const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308"];

/** "eye" looks from a model's eye line (see `eye`). */
export type View = "3d" | "top" | "eye";

/**
 * How peers reach each other. "online" is WebRTC between browsers;
 * "local" links tabs of the same browser; "hotseat" is one screen, both sides.
 */
export type Mode = "online" | "local" | "hotseat";

export interface StartOptions {
  role: Role;
  mode: Mode;
  roomId?: string;
  name: string;
  /** Resume a saved game (host only). */
  record?: GameRecord;
  /** Game system for a new game (host only); 40k when missing. */
  system?: string;
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
}

const SAVE_KEY = "open-battle:last-game";

export interface SavedGame {
  mode: Mode;
  roomId: string | null;
  record: GameRecord;
  savedAt: number;
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
export interface SavedRoom {
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

function saveRoom(roomId: string, record: GameRecord, seatedAs: string | undefined, role: Role) {
  try {
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

function saveGame(game: SavedGame) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
  } catch {
    // Storage full or blocked: the game goes on, it just can't be resumed.
  }
}

export const HOTSEAT_PLAYERS: Player[] = [
  { id: "p1", name: "Player 1", color: COLORS[0]!, seat: 0 },
  { id: "p2", name: "Player 2", color: COLORS[1]!, seat: 1 },
];

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
  net: null,
  packagesWaived: {},
  seatAgain: null,
  arcs: true,
  eye: null,
  set: (patch) => set(patch),
  setView: (view) => set({ view, ...(view === "eye" ? {} : { eye: null }) }),
  cameraReset: 0,
  resetView: () =>
    set((s) => ({ view: s.view === "eye" ? "3d" : s.view, eye: null, cameraReset: s.cameraReset + 1 })),
  select: (selected) => set({ selected }),
  setDraft: (draft) => set({ draft }),
  setScrub: (scrub) => set({ scrub }),

  start({ role, mode, roomId, name, record, system }) {
    get().session?.leave();
    const transport =
      mode === "hotseat"
        ? createLoopbackNetwork().connect("solo")
        : mode === "local"
          ? broadcastTransport(roomId!)
          : trysteroTransport(roomId!);
    // A client coming back to a room picks up the log it saved there, and asks only for what it missed.
    const room = mode === "hotseat" || !roomId ? null : loadRoom(roomId);
    const resumed = role === "host" && !!record && mode !== "hotseat";
    let seated = role === "spectator";
    const session: Session = new Session({
      transport,
      role,
      record: record ?? (role === "client" ? room?.record : undefined),
      resumed,
      // A peer missing one of the game's rules packages can't host it.
      ready: (state) =>
        (state.packages?.packages ?? []).every((p) => !!useLibrary.getState().packages[p.hash]),
      onChange: (game, rec) => {
        // A session that was replaced (left) may still call back; ignore it.
        if (get().session !== session) return;
        set({ game, record: rec });
        const current = session?.status.role ?? role;
        if (current === "host") saveGame({ mode, roomId: roomId ?? null, record: rec, savedAt: Date.now() });
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
        set({ net: status, role: status.role });
        takeSeat();
      },
    });
    set({
      session,
      role,
      mode,
      roomId: roomId ?? null,
      game: session.current,
      record: session.log,
      net: session.status,
      selected: null,
      draft: null,
      scrub: null,
      // Spectators start with the camera following the action.
      director: role === "spectator",
      packagesWaived: {},
      seatAgain: () => takeSeat(),
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
      const mine = room?.playerId ?? (resumed ? players.find((p) => p.seat === 0)?.id : undefined);
      seated = true;
      if (mine && game.players[mine] && !status.peers.includes(mine)) {
        session.dispatch({ type: "player/claim", player: mine });
        return;
      }
      if (status.role === "host") return;
      if (players.filter((p) => p.seat !== undefined).length >= 2) return;
      session.dispatch({
        type: "player/join",
        player: { id: session.selfId, name, color: COLORS[1]!, seat: 1 },
      });
    }

    if (role !== "host") {
      takeSeat();
      return;
    }
    if (record) {
      // A resumed host first finds out whether the room has moved on without it
      // (it may stand down), then takes its seat back.
      setTimeout(takeSeat, 1500);
      return;
    }
    seated = true;
    if (mode === "hotseat") {
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
    set({ session: null, role: "spectator", record, scrub, selected: null, draft: null, director: true });
  },

  dispatch(intent, as) {
    const { session, mode, game } = get();
    if (!session) return;
    if (mode === "hotseat") {
      const active = Object.values(game.players).find((p) => p.seat === game.turn.activeSeat);
      session.dispatch(intent, as ?? active?.id);
    } else session.dispatch(intent);
  },
}));

/** Who this browser plays as, for permissions. Hotseat controls everything. */
export function useCanControl(): (owner: PlayerId) => boolean {
  const mode = useStore((s) => s.mode);
  const role = useStore((s) => s.role);
  const selfId = useStore((s) => s.session?.selfId);
  return (owner) => role !== "spectator" && (mode === "hotseat" || owner === selfId);
}
