import { create } from "zustand";
import { createInitialState, type GameState, type Intent, type Model, type Player } from "./core";
import { createLoopbackNetwork } from "./net/loopback";
import { Session, type Role } from "./net/session";
import { trysteroTransport } from "./net/trystero";

const COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308"];

interface Store {
  game: GameState;
  session: Session | null;
  roomId: string | null;
  start(options: { role: Role; roomId?: string; name: string }): void;
  dispatch(intent: Intent): void;
}

export const useStore = create<Store>((set, get) => ({
  game: createInitialState(),
  session: null,
  roomId: null,

  start({ role, roomId, name }) {
    get().session?.leave();
    const transport = roomId ? trysteroTransport(roomId) : createLoopbackNetwork().connect("solo");
    const session = new Session({ transport, role, onState: (game) => set({ game }) });
    set({ session, roomId: roomId ?? null, game: session.current });

    const color = COLORS[role === "host" ? 0 : 1]!;
    const player: Player = { id: session.selfId, name, color };
    if (role === "host") {
      session.dispatch({ type: "player/join", player });
      for (const model of demoSquad(player, -20)) session.dispatch({ type: "model/add", model });
    } else {
      // Wait for the host's snapshot before announcing ourselves.
      const unsubscribe = useStore.subscribe((s) => {
        if (s.game.seq === 0) return;
        unsubscribe();
        session.dispatch({ type: "player/join", player });
        for (const model of demoSquad(player, 20)) session.dispatch({ type: "model/add", model });
      });
    }
  },

  dispatch(intent) {
    get().session?.dispatch(intent);
  },
}));

/** Placeholder models so there is something to push around. */
function demoSquad(owner: Player, x: number): Model[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `${owner.id}-${i}`,
    owner: owner.id,
    label: `Model ${i + 1}`,
    position: { x, y: (i - 2) * 2 },
    facing: 0,
    baseMm: 32,
  }));
}
