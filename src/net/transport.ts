import type { GameRecord, Intent, LoggedEvent } from "../core";

/** The host's state hash after event `seq` (see core/checksum.ts). */
export interface Check {
  seq: number;
  hash: number;
}

/** Wire protocol. The host is authoritative: clients send intents, the host
 * broadcasts logged events, and late joiners get the whole record. */
export type NetMessage =
  /**
   * A non-host greeting a peer: what log it already holds (`seq`, and `tail`
   * to check it is the same log), so the host sends only what is missing.
   */
  | { t: "hello"; seq?: number; tail?: string; role?: "host" | "client" | "spectator" }
  | { t: "intent"; intent: Intent }
  /** `check`: the host's state checksum after an earlier event, riding along with this one. */
  | { t: "event"; logged: LoggedEvent; check?: Check }
  /** Events a reconnecting peer missed, in order. */
  | { t: "events"; events: LoggedEvent[]; check?: Check }
  | { t: "record"; record: GameRecord }
  /** "I am the host": sent to each peer met, and when taking over a room. */
  | { t: "host"; seq: number; resumed?: boolean }
  /** A peer's log length and role, shared while choosing a new host. */
  /** `ready`: it holds every rules package the game names, so it could become host. */
  | { t: "sync"; seq: number; role: "host" | "client" | "spectator"; ready?: boolean }
  /** A host standing down in favour of `to`. */
  | { t: "yield"; to: string }
  | SideMessage;

/**
 * Peer-to-peer traffic outside the game log, such as uploaded figures
 * (src/assets/share.ts). Any peer may send these to any other.
 */
export type SideMessage =
  | { t: "asset/want"; id: string }
  | { t: "asset/part"; id: string; part: number; parts: number; data: string }
  /** Rules packages, by the SHA-256 of their bytes (src/packages/share.ts). */
  | { t: "package/want"; hash: string }
  | { t: "package/part"; hash: string; part: number; parts: number; data: string }
  /** Which of the game's packages this peer is still getting (empty when it has them all). */
  | { t: "package/status"; missing: string[] }
  /** Table talk (src/talk): pings, drawings, chat and reactions. Never logged or checksummed. */
  /** `name`: what a spectator calls themselves (players go by their seat's name). */
  | { t: "talk"; item: TalkItem; name?: string }
  /** Wipe the sender's drawings. */
  | { t: "talk/clear" }
  /** A commentator's camera (Broadcast mode), a few times a second; null when they stop. */
  | {
      t: "talk/cam";
      cam: { target: [number, number, number]; position: [number, number, number] } | null;
      name?: string;
    }
  /** A commentator brings up a moment-of-the-game card (after the game), by its seq and kind. */
  | { t: "talk/moment"; seq: number; kind: string };

/** A short-lived message over the table, from whoever sent it. */
export type TalkItem = { id: string } & (
  | { kind: "ping"; at: { x: number; y: number }; unitId?: string }
  | { kind: "arrow"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "area"; at: { x: number; y: number }; radius: number }
  | { kind: "chat"; text: string }
  | { kind: "react"; emoji: string }
);

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
