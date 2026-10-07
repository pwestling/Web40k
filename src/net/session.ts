import {
  applyEvent,
  createInitialState,
  resolveIntent,
  type GameState,
  type Intent,
  type Rng,
} from "../core";
import type { Transport } from "./transport";

export type Role = "host" | "client";

export interface SessionOptions {
  transport: Transport;
  role: Role;
  onState: (state: GameState) => void;
  initialState?: GameState;
  rng?: Rng;
}

/**
 * Keeps one peer's copy of the game in sync.
 *
 * The host resolves every intent (its own and clients') into an event,
 * applies it and broadcasts it. Clients forward intents to the host and only
 * change state when the host's event comes back. This keeps dice honest and
 * ordering simple; a lockstep or CRDT model can replace it later behind the
 * same `dispatch` API.
 */
export class Session {
  private state: GameState;
  private hostId: string | null = null;
  private readonly transport: Transport;
  private readonly role: Role;
  private readonly onState: (state: GameState) => void;
  private readonly rng: Rng;

  constructor({ transport, role, onState, initialState, rng }: SessionOptions) {
    this.transport = transport;
    this.role = role;
    this.onState = onState;
    this.rng = rng ?? Math.random;
    this.state = initialState ?? createInitialState();

    // Clients greet every peer they meet; only the host answers with a snapshot.
    transport.onPeerJoin((peerId) => {
      if (this.role === "client") this.transport.send({ t: "hello" }, peerId);
    });

    transport.onMessage((message, from) => {
      if (this.role === "host") {
        if (message.t === "intent") this.hostApply(message.intent, from);
        if (message.t === "hello") this.transport.send({ t: "snapshot", state: this.state }, from);
        return;
      }
      if (message.t === "snapshot") {
        this.hostId = from;
        this.setState(message.state);
      } else if (message.t === "event" && from === this.hostId && message.seq === this.state.seq + 1) {
        this.setState(applyEvent(this.state, message.event));
      }
      // Events that arrive out of order are dropped for now; a client that
      // falls behind can recover by sending `hello` for a fresh snapshot.
    });
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get current(): GameState {
    return this.state;
  }

  dispatch(intent: Intent): void {
    if (this.role === "host") this.hostApply(intent, this.selfId);
    else if (this.hostId) this.transport.send({ t: "intent", intent }, this.hostId);
  }

  leave(): void {
    this.transport.leave();
  }

  private hostApply(intent: Intent, from: string): void {
    const event = resolveIntent(intent, from, this.rng);
    if (!event) return;
    this.setState(applyEvent(this.state, event));
    this.transport.send({ t: "event", seq: this.state.seq, event });
  }

  private setState(state: GameState): void {
    this.state = state;
    this.onState(state);
  }
}
