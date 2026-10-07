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
import type { NetMessage, SideMessage, Transport } from "./transport";

/** Spectators receive the game like clients but never send intents. */
export type Role = "host" | "client" | "spectator";

/** Who is connected and who is host, for the reconnecting banner. */
export interface NetStatus {
  role: Role;
  hostId: string | null;
  /** Peers connected right now. */
  peers: string[];
  /** The host has left and the room is choosing (or waiting for) a new one. */
  migrating: boolean;
}

export interface SessionOptions {
  transport: Transport;
  role: Role;
  onChange: (state: GameState, record: GameRecord) => void;
  record?: GameRecord;
  rng?: Rng;
  now?: () => number;
  /**
   * A host resuming a saved game. It takes the room back from a host that
   * replaced it only if its log is at least as long; otherwise it rejoins as
   * a client.
   */
  resumed?: boolean;
  /** How long peers wait for a departed host to come back before choosing a new one. */
  graceMs?: number;
  /** Told when this peer's role, the host or the connected peers change. */
  onNet?: (status: NetStatus) => void;
}

/** A short fingerprint of the log up to `seq`, so a peer can tell it holds the same history. */
export function tailOf(record: GameRecord, seq = lastSeq(record)): string {
  const e = record.events.find((x) => x.seq === seq);
  return e ? `${e.seq}:${e.at}:${e.by}:${e.event.type}` : "";
}

/** Host order: the longer log wins, then a host resuming its own game, then the lower peer id. */
function beats(
  a: { id: string; seq: number; resumed?: boolean },
  b: { id: string; seq: number; resumed?: boolean },
) {
  if (a.seq !== b.seq) return a.seq > b.seq;
  if (!!a.resumed !== !!b.resumed) return !!a.resumed;
  return a.id < b.id;
}

/**
 * Keeps one peer's copy of the game log in sync.
 *
 * The host resolves every intent (its own and other players') into a logged
 * event, appends it and broadcasts it. Everyone else forwards intents to the
 * host and only changes when the host's event comes back. Peers joining or
 * coming back say how much of the log they hold and get only what they
 * missed (or the whole record if their history differs).
 *
 * If the host leaves, the players left wait `graceMs` for it, then the one
 * with the longest log (lowest peer id on a tie) takes over; every peer
 * works this out the same way, and should two hosts ever meet, the lesser
 * one stands down. Each logged event records which host logged it.
 */
export class Session {
  private record: GameRecord;
  private state: GameState;
  private hostId: string | null = null;
  private hostInfo: { seq: number; resumed?: boolean } = { seq: 0 };
  private role: Role;
  private resumed: boolean;
  private migrating = false;
  private readonly peers = new Map<string, { role?: Role; seq?: number }>();
  private queue: Intent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private left = false;
  private readonly transport: Transport;
  private readonly onChange: SessionOptions["onChange"];
  private readonly onNet: SessionOptions["onNet"];
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly graceMs: number;
  private onSide: ((message: SideMessage, from: string) => void) | null = null;
  private onPeer: ((peerId: string) => void) | null = null;

  constructor({ transport, role, onChange, record, rng, now, resumed, graceMs, onNet }: SessionOptions) {
    this.transport = transport;
    this.role = role;
    this.resumed = !!resumed && role === "host";
    this.onChange = onChange;
    this.onNet = onNet;
    this.rng = rng ?? Math.random;
    this.now = now ?? Date.now;
    this.graceMs = graceMs ?? 4000;
    this.record = record ?? createRecord();
    this.state = stateAt(this.record);
    if (role === "host") this.hostId = transport.selfId;

    transport.onPeerJoin((peerId) => {
      if (!this.peers.has(peerId)) this.peers.set(peerId, {});
      // Hosts say so; everyone else says how much log it holds (used to pick a new host).
      if (this.role === "host") this.announce(peerId);
      else this.transport.send({ t: "sync", seq: lastSeq(this.record), role: this.role }, peerId);
      this.onPeer?.(peerId);
      this.notify();
    });

    transport.onPeerLeave((peerId) => {
      this.peers.delete(peerId);
      if (peerId === this.hostId && this.role !== "host") {
        this.hostId = null;
        this.startMigration();
      }
      this.notify();
    });

    transport.onMessage((message, from) => this.receive(message, from));
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

  get status(): NetStatus {
    return { role: this.role, hostId: this.hostId, peers: [...this.peers.keys()], migrating: this.migrating };
  }

  /**
   * Ask for an intent. The host may act `as` another player, which is how a
   * hotseat game on one screen plays both sides. While the room has no host
   * (it is choosing a new one), intents wait and go to the new host.
   */
  dispatch(intent: Intent, as?: string): void {
    if (this.left) return;
    if (this.role === "host") this.hostApply(intent, as ?? this.selfId);
    else if (this.role === "client") {
      if (this.hostId) this.transport.send({ t: "intent", intent }, this.hostId);
      else this.queue.push(intent);
    }
  }

  /** Receive side-channel messages (see SideMessage) and hear when peers connect. Null to stop. */
  listenSide(
    onSide: ((message: SideMessage, from: string) => void) | null,
    onPeer: ((peerId: string) => void) | null = null,
  ): void {
    this.onSide = onSide;
    this.onPeer = onPeer;
  }

  /** Send a side-channel message to one peer, or everyone. */
  sendSide(message: SideMessage, to?: string): void {
    this.transport.send(message, to);
  }

  leave(): void {
    this.left = true;
    if (this.timer) clearTimeout(this.timer);
    this.transport.leave();
  }

  private receive(message: NetMessage, from: string): void {
    if (message.t.startsWith("asset/")) {
      this.onSide?.(message as SideMessage, from);
      return;
    }
    switch (message.t) {
      case "hello":
        this.peers.set(from, { role: message.role, seq: message.seq });
        if (this.role === "host") this.catchUp(from, message.seq, message.tail);
        return;
      case "sync":
        this.peers.set(from, { role: message.role, seq: message.seq });
        return;
      case "intent":
        if (this.role === "host") this.hostApply(message.intent, from);
        return;
      case "host":
        this.heardHost(from, message.seq, message.resumed);
        return;
      case "yield":
        if (this.role !== "host" && from === this.hostId) this.follow(message.to, { seq: 0 });
        return;
      case "record":
        if (this.role === "host") return;
        if (this.hostId === null) this.follow(from, { seq: lastSeq(message.record) }, false);
        if (from !== this.hostId) return;
        this.record = message.record;
        this.state = stateAt(this.record);
        this.onChange(this.state, this.record);
        return;
      case "events":
        if (this.role === "host" || from !== this.hostId) return;
        for (const logged of message.events) if (!this.take(logged, from)) return;
        return;
      case "event":
        if (this.role !== "host" && from === this.hostId) this.take(message.logged, from);
        return;
    }
  }

  /** Append the host's next event; on a gap, ask for what is missing. False when it asked. */
  private take(logged: LoggedEvent, from: string): boolean {
    const last = lastSeq(this.record);
    if (logged.seq <= last) return true;
    if (logged.seq === last + 1) {
      this.append(logged);
      return true;
    }
    this.transport.send(this.hello(), from);
    return false;
  }

  private hello(): NetMessage {
    const seq = lastSeq(this.record);
    return { t: "hello", seq, tail: tailOf(this.record, seq), role: this.role };
  }

  private greet(peerId: string): void {
    this.transport.send(this.hello(), peerId);
  }

  private announce(to?: string): void {
    this.transport.send({ t: "host", seq: lastSeq(this.record), resumed: this.resumed }, to);
  }

  /** Send a peer the events after `seq` if its log matches ours that far, else the whole record. */
  private catchUp(to: string, seq?: number, tail?: string): void {
    if (seq !== undefined && seq > 0 && seq <= lastSeq(this.record) && tailOf(this.record, seq) === tail) {
      this.transport.send({ t: "events", events: this.record.events.filter((e) => e.seq > seq) }, to);
    } else this.transport.send({ t: "record", record: this.record }, to);
  }

  /** Another peer says it is host. */
  private heardHost(from: string, seq: number, resumed?: boolean): void {
    const them = { id: from, seq, resumed };
    if (this.role === "host") {
      const me = { id: this.selfId, seq: lastSeq(this.record), resumed: this.resumed };
      if (beats(them, me)) this.standDown(from, them);
      // Make sure the other host hears us too, so it stands down.
      else this.announce(from);
      return;
    }
    if (from === this.hostId) {
      this.hostInfo = { seq, resumed };
      return;
    }
    const current = this.hostId && this.peers.has(this.hostId) ? { id: this.hostId, ...this.hostInfo } : null;
    if (!current || beats(them, current)) this.follow(from, { seq, resumed });
  }

  /** Make `hostId` our host: ask it for what we miss and send it anything we held back. */
  private follow(hostId: string, info: { seq: number; resumed?: boolean }, greet = true): void {
    this.hostId = hostId;
    this.hostInfo = info;
    this.migrating = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (greet) this.greet(hostId);
    if (this.role === "client")
      for (const intent of this.queue.splice(0)) this.transport.send({ t: "intent", intent }, hostId);
    this.notify();
  }

  private standDown(winner: string, info: { seq: number; resumed?: boolean }): void {
    this.role = "client";
    this.resumed = false;
    this.transport.send({ t: "yield", to: winner });
    this.follow(winner, info);
  }

  /** The host has gone: tell everyone how much log we hold, wait, then pick the new host. */
  private startMigration(): void {
    this.migrating = true;
    if (this.role !== "spectator")
      this.transport.send({ t: "sync", seq: lastSeq(this.record), role: this.role });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.elect(), this.graceMs);
  }

  private elect(): void {
    this.timer = null;
    if (this.left || this.hostId !== null || this.role === "host") return;
    const candidates = [...this.peers.entries()]
      .filter(([, p]) => p.role === "client")
      .map(([id, p]) => ({ id, seq: p.seq ?? 0 }));
    if (this.role === "client") candidates.push({ id: this.selfId, seq: lastSeq(this.record) });
    const best = candidates.reduce<{ id: string; seq: number } | null>(
      (a, c) => (a === null || beats(c, a) ? c : a),
      null,
    );
    if (best?.id === this.selfId) {
      this.role = "host";
      this.hostId = this.selfId;
      this.migrating = false;
      this.announce();
      for (const intent of this.queue.splice(0)) this.hostApply(intent, this.selfId);
      this.notify();
      return;
    }
    // Waiting on someone else (or on a player to come back): ask again later.
    if (this.role !== "spectator")
      this.transport.send({ t: "sync", seq: lastSeq(this.record), role: this.role });
    this.schedule();
  }

  private hostApply(intent: Intent, from: string): void {
    const resolved = resolveLogged(this.record, intent, from, this.rng, this.now(), this.state);
    if (!resolved) return;
    const logged: LoggedEvent = { ...resolved, host: this.selfId };
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

  private notify(): void {
    this.onNet?.(this.status);
  }
}
