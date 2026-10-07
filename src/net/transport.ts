import type { GameRecord, Intent, LoggedEvent } from "../core";

/** Wire protocol. The host is authoritative: clients send intents, the host
 * broadcasts logged events, and late joiners get the whole record. */
export type NetMessage =
  | { t: "hello" }
  | { t: "intent"; intent: Intent }
  | { t: "event"; logged: LoggedEvent }
  | { t: "record"; record: GameRecord }
  | SideMessage;

/**
 * Peer-to-peer traffic outside the game log, such as uploaded figures
 * (src/assets/share.ts). Any peer may send these to any other.
 */
export type SideMessage =
  | { t: "asset/want"; id: string }
  | { t: "asset/part"; id: string; part: number; parts: number; data: string };

/** Minimal peer-to-peer channel the session needs. Implemented over WebRTC by
 * `trysteroTransport` and in memory by `createLoopbackNetwork` for tests. */
export interface Transport {
  readonly selfId: string;
  /** Send to one peer, or to everyone when `to` is omitted. */
  send(message: NetMessage, to?: string): void;
  onMessage(handler: (message: NetMessage, from: string) => void): void;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  leave(): void;
}
