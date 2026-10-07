import { create } from "zustand";
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
import { Session, type Role } from "./net/session";
import { trysteroTransport } from "./net/trystero";
import { systemModule } from "./systems";

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
  /** Unit name plates over the table. */
  plates: boolean;
  /** Ruler tool: drags on the table measure instead of moving. */
  measuring: boolean;
  /** Unit whose move and weapon ranges are drawn around its models. */
  ranges: UnitId | null;
  /** Weapon whose range Ranges shows (default: the unit's longest). */
  rangeWeapon: string | null;
  /** Director camera: follows the latest action (moves, shots, charges). */
  director: boolean;
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
        | "plates"
        | "measuring"
        | "ranges"
        | "rangeWeapon"
        | "director"
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
  plates: true,
  measuring: false,
  ranges: null,
  rangeWeapon: null,
  director: false,
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
    const session = new Session({
      transport,
      role,
      record,
      onChange: (game, rec) => {
        set({ game, record: rec });
        if (role === "host") saveGame({ mode, roomId: roomId ?? null, record: rec, savedAt: Date.now() });
      },
    });
    set({
      session,
      role,
      mode,
      roomId: roomId ?? null,
      game: session.current,
      record: session.log,
      selected: null,
      draft: null,
      scrub: null,
      // Spectators start with the camera following the action.
      director: role === "spectator",
    });
    if (role === "spectator") return;

    if (role === "host") {
      if (record) {
        // A resumed online game: take back the host's old seat under our new peer id.
        const host = Object.values(session.current.players).find((p) => p.seat === 0);
        if (mode !== "hotseat" && host && host.id !== session.selfId)
          session.dispatch({ type: "player/claim", player: host.id });
        return;
      }
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
      return;
    }

    // Clients wait for the host's snapshot, then take a free seat or watch.
    const unsubscribe = useStore.subscribe((s) => {
      if (s.game.seq === 0) return;
      unsubscribe();
      const seated = Object.values(s.game.players);
      if (seated.some((p) => p.id === session.selfId)) return;
      if (seated.filter((p) => p.seat !== undefined).length >= 2) return;
      session.dispatch({
        type: "player/join",
        player: { id: session.selfId, name, color: COLORS[1]!, seat: 1 },
      });
    });
  },

  openReplay(record) {
    get().session?.leave();
    set({ session: null, role: "spectator", record, scrub: 0, selected: null, draft: null, director: true });
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
