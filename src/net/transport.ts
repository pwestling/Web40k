import type { GameEvent, GameState, Intent } from "../core";

/** Wire protocol. The host is authoritative: clients send intents, the host
 * broadcasts numbered events, and late joiners get a snapshot. */
export type NetMessage =
  | { t: "hello" }
  | { t: "intent"; intent: Intent }
  | { t: "event"; seq: number; event: GameEvent }
  | { t: "snapshot"; state: GameState };

/** Minimal peer-to-peer channel the session needs. Implemented over WebRTC by
 * `trysteroTransport` and in memory by `createLoopbackPair` for tests. */
export interface Transport {
  readonly selfId: string;
  /** Send to one peer, or to everyone when `to` is omitted. */
  send(message: NetMessage, to?: string): void;
  onMessage(handler: (message: NetMessage, from: string) => void): void;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  leave(): void;
}
