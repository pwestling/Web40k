import { create } from "zustand";
import {
  createInitialState,
  rankedOffsets,
  rotate,
  type BaseShape,
  type GameState,
  type Intent,
  type Model,
  type Player,
  type Unit,
} from "./core";
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
      session.dispatch(demoSkirmishUnit(player, -20));
      // Solo play gets both demo units so both movement styles can be tried.
      if (!roomId) session.dispatch(demoRankedUnit(player, 20));
    } else {
      // Wait for the host's snapshot before announcing ourselves.
      const unsubscribe = useStore.subscribe((s) => {
        if (s.game.seq === 0) return;
        unsubscribe();
        session.dispatch({ type: "player/join", player });
        session.dispatch(demoRankedUnit(player, 20));
      });
    }
  },

  dispatch(intent) {
    get().session?.dispatch(intent);
  },
}));

/** Placeholder units so there is something to push around: a loose squad of
 * round bases, and a ranked block of square bases to show both styles. */
function demoSkirmishUnit(owner: Player, x: number): Intent {
  const unitId = `${owner.id}-squad`;
  const base: BaseShape = { shape: "round", diameterMm: 32 };
  const models: Model[] = Array.from({ length: 5 }, (_, i) => ({
    id: `${unitId}-${i}`,
    owner: owner.id,
    label: `Model ${i + 1}`,
    position: { x, y: (i - 2) * 2 },
    facing: Math.PI / 2,
    base,
  }));
  const unit: Unit = {
    id: unitId,
    owner: owner.id,
    name: "Squad",
    modelIds: [],
    formation: { kind: "skirmish" },
  };
  return { type: "unit/add", unit, models };
}

function demoRankedUnit(owner: Player, x: number): Intent {
  const unitId = `${owner.id}-regiment`;
  const base: BaseShape = { shape: "rect", widthMm: 25, depthMm: 25 };
  const facing = -Math.PI / 2; // Facing -x, towards the other player.
  const models: Model[] = rankedOffsets(15, 5, base).map((offset, i) => {
    const p = rotate(offset, facing);
    return {
      id: `${unitId}-${i}`,
      owner: owner.id,
      label: `Model ${i + 1}`,
      position: { x: x + p.x, y: p.y },
      facing,
      base,
    };
  });
  const unit: Unit = {
    id: unitId,
    owner: owner.id,
    name: "Regiment",
    modelIds: [],
    formation: { kind: "ranked", files: 5 },
  };
  return { type: "unit/add", unit, models };
}
