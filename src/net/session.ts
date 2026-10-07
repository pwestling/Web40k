import {
  appendEvent,
  applyEvent,
  createRecord,
  lastSeq,
  resolveLogged,
  stateAt,
  type GameRecord,
  type GameState,
  type Intent,
  type LoggedEvent,
  type Rng,
} from "../core";
import type { Transport } from "./transport";

/** Spectators receive the game like clients but never send intents. */
export type Role = "host" | "client" | "spectator";

export interface SessionOptions {
  transport: Transport;
  role: Role;
  onChange: (state: GameState, record: GameRecord) => void;
  record?: GameRecord;
  rng?: Rng;
  now?: () => number;
}

/**
 * Keeps one peer's copy of the game log in sync.
 *
 * The host resolves every intent (its own and other players') into a logged
 * event, appends it and broadcasts it. Everyone else forwards intents to the
 * host and only changes when the host's event comes back. Late joiners and
 * spectators get the whole record, so they can scrub back through it too.
 */
export class Session {
  private record: GameRecord;
  private state: GameState;
  private hostId: string | null = null;
  private readonly transport: Transport;
  private readonly role: Role;
  private readonly onChange: SessionOptions["onChange"];
  private readonly rng: Rng;
  private readonly now: () => number;

  constructor({ transport, role, onChange, record, rng, now }: SessionOptions) {
    this.transport = transport;
    this.role = role;
    this.onChange = onChange;
    this.rng = rng ?? Math.random;
    this.now = now ?? Date.now;
    this.record = record ?? createRecord();
    this.state = stateAt(this.record);

    // Non-hosts greet every peer they meet; only the host answers.
    transport.onPeerJoin((peerId) => {
      if (this.role !== "host") this.transport.send({ t: "hello" }, peerId);
    });

    transport.onMessage((message, from) => {
      if (this.role === "host") {
        if (message.t === "intent") this.hostApply(message.intent, from);
        if (message.t === "hello") this.transport.send({ t: "record", record: this.record }, from);
        return;
      }
      if (message.t === "record") {
        this.hostId = from;
        this.record = message.record;
        this.state = stateAt(this.record);
        this.onChange(this.state, this.record);
      } else if (message.t === "event" && from === this.hostId) {
        if (message.logged.seq === lastSeq(this.record) + 1) this.append(message.logged);
        // A gap means we missed something: ask for the full record again.
        else this.transport.send({ t: "hello" }, from);
      }
    });
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get current(): GameState {
    return this.state;
  }

  get log(): GameRecord {
    return this.record;
  }

  /**
   * Ask for an intent. The host may act `as` another player, which is how a
   * hotseat game on one screen plays both sides.
   */
  dispatch(intent: Intent, as?: string): void {
    if (this.role === "host") this.hostApply(intent, as ?? this.selfId);
    else if (this.role === "client" && this.hostId) this.transport.send({ t: "intent", intent }, this.hostId);
  }

  leave(): void {
    this.transport.leave();
  }

  private hostApply(intent: Intent, from: string): void {
    const logged = resolveLogged(this.record, intent, from, this.rng, this.now(), this.state);
    if (!logged) return;
    this.append(logged);
    this.transport.send({ t: "event", logged });
  }

  private append(logged: LoggedEvent): void {
    this.record = appendEvent(this.record, logged);
    // Undo changes history, so rebuild; everything else folds in directly.
    this.state =
      logged.event.type === "undo"
        ? stateAt(this.record)
        : { ...applyEvent(this.state, logged.event), seq: logged.seq };
    this.onChange(this.state, this.record);
  }
}
