import {
  appendEvent,
  applyEvent,
  createRecord,
  isCheckpoint,
  stateHash,
  lastSeq,
  resolveLogged,
  stateAt,
  type GameEvent,
  type GameRecord,
  type GameState,
  type Intent,
  type LoggedEvent,
  type Rng,
} from "../core";
import { hookIntents } from "../core/script";
import type { Check, NetMessage, SideMessage, Transport } from "./transport";

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
  /**
   * This peer's state stopped matching the host's after event `seq` (the
   * checksums differ); `count` is how many times it has happened this game.
   */
  desync: { seq: number; count: number; host: number; mine: number } | null;
}

/** Checkpoints kept for comparing against the host's checksums. */
const KEEP_CHECKS = 32;

/**
 * Intents the host hands to the rules-package sandbox (src/sandbox): the
 * router returns how to resolve one there, or null to resolve it here. The
 * host draws a seed from its rng for the sandbox's dice.
 */
export type IntentRouter = (
  intent: Intent,
  from: string,
  state: GameState,
) => ((seed: number) => Promise<GameEvent | null>) | null;

let router: IntentRouter | null = null;

export function setIntentRouter(r: IntentRouter | null): void {
  router = r;
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
  /**
   * Whether this peer holds every rules package the game names, so it could
   * take over as host. Peers that aren't ready never win an election.
   */
  ready?: (state: GameState) => boolean;
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
  private readonly peers = new Map<string, { role?: Role; seq?: number; ready?: boolean }>();
  private readonly isReady: (state: GameState) => boolean;
  private queue: Intent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private left = false;
  private readonly transport: Transport;
  private readonly onChange: SessionOptions["onChange"];
  private readonly onNet: SessionOptions["onNet"];
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly graceMs: number;
  /** Side-channel listeners by owner (figures, rules packages). */
  private readonly side = new Map<
    string,
    { onSide: (message: SideMessage, from: string) => void; onPeer: ((peerId: string) => void) | null }
  >();
  /** States at recent checkpoints, hashed lazily (off the hot path). */
  private readonly checks = new Map<number, { state: GameState; hash?: number }>();
  /** Host: the checkpoint whose hash rides on the next event sent. */
  private pendingCheck: number | null = null;
  private desync: NetStatus["desync"] = null;
  private desyncs = 0;

  constructor({
    transport,
    role,
    onChange,
    record,
    rng,
    now,
    resumed,
    graceMs,
    onNet,
    ready,
  }: SessionOptions) {
    this.isReady = ready ?? (() => true);
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
      else this.transport.send(this.sync(), peerId);
      for (const l of this.side.values()) l.onPeer?.(peerId);
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
    return {
      role: this.role,
      hostId: this.hostId,
      peers: [...this.peers.keys()],
      migrating: this.migrating,
      desync: this.desync,
    };
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
    key = "assets",
  ): void {
    if (onSide) this.side.set(key, { onSide, onPeer });
    else this.side.delete(key);
  }

  /** Send a side-channel message to one peer, or everyone. */
  sendSide(message: SideMessage, to?: string): void {
    this.transport.send(message, to);
  }

  /**
   * Replace this peer's table with the host's after a checksum mismatch. A
   * player's resync is logged (it is evidence of a bug or mismatched code);
   * a spectator just asks for the record again.
   */
  resync(): void {
    if (this.left || this.role === "host" || !this.hostId) return;
    if (this.role === "client")
      this.transport.send({ t: "intent", intent: { type: "player/resync" } }, this.hostId);
    else this.transport.send({ t: "hello", role: this.role }, this.hostId);
  }

  /** This peer's checksum after event `seq`, if that was a recent checkpoint. */
  /**
   * Fold the whole log again: a game system arrived (a rules package loaded)
   * after events that depend on it were folded with its stand-in.
   */
  refold(): void {
    this.state = stateAt(this.record);
    this.checks.clear();
    this.onChange(this.state, this.record);
  }

  checksumAt(seq: number): number | undefined {
    const c = this.checks.get(seq);
    if (!c) return undefined;
    c.hash ??= stateHash(c.state);
    return c.hash;
  }

  leave(): void {
    this.left = true;
    if (this.timer) clearTimeout(this.timer);
    this.transport.leave();
  }

  private receive(message: NetMessage, from: string): void {
    if (message.t.startsWith("asset/") || message.t.startsWith("package/") || message.t.startsWith("talk")) {
      for (const l of this.side.values()) l.onSide(message as SideMessage, from);
      return;
    }
    switch (message.t) {
      case "hello":
        this.peers.set(from, { role: message.role, seq: message.seq });
        if (this.role === "host") this.catchUp(from, message.seq, message.tail);
        return;
      case "sync":
        this.peers.set(from, { role: message.role, seq: message.seq, ready: message.ready !== false });
        return;
      case "intent":
        if (this.role !== "host") return;
        this.hostApply(message.intent, from);
        // A resync is logged first, so the record sent includes it.
        if (message.intent.type === "player/resync")
          this.transport.send({ t: "record", record: this.record }, from);
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
        // A fresh copy of the host's table: earlier checkpoints no longer apply.
        this.checks.clear();
        if (this.desync) {
          this.desync = null;
          this.notify();
        }
        this.onChange(this.state, this.record);
        return;
      case "events":
        if (this.role === "host" || from !== this.hostId) return;
        for (const logged of message.events) if (!this.take(logged, from)) return;
        if (message.check) this.verify(message.check);
        return;
      case "event":
        if (this.role !== "host" && from === this.hostId && this.take(message.logged, from) && message.check)
          this.verify(message.check);
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
      const latest = Math.max(-1, ...[...this.checks.keys()].filter((k) => k > seq));
      const hash = latest > 0 ? this.checksumAt(latest) : undefined;
      this.transport.send(
        {
          t: "events",
          events: this.record.events.filter((e) => e.seq > seq),
          ...(hash !== undefined ? { check: { seq: latest, hash } } : {}),
        },
        to,
      );
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
    if (this.role !== "spectator") this.transport.send(this.sync());
    this.schedule();
  }

  private sync(): NetMessage {
    return { t: "sync", seq: lastSeq(this.record), role: this.role, ready: this.isReady(this.state) };
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.elect(), this.graceMs);
  }

  private elect(): void {
    this.timer = null;
    if (this.left || this.hostId !== null || this.role === "host") return;
    // Only a peer holding every rules package can host; if none can, the room waits.
    const candidates = [...this.peers.entries()]
      .filter(([, p]) => p.role === "client" && p.ready !== false)
      .map(([id, p]) => ({ id, seq: p.seq ?? 0 }));
    if (this.role === "client" && this.isReady(this.state))
      candidates.push({ id: this.selfId, seq: lastSeq(this.record) });
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
    if (this.role !== "spectator") this.transport.send(this.sync());
    this.schedule();
  }

  /** Intents waiting while the sandbox resolves one, so events keep their order. */
  private waiting: [Intent, string][] = [];
  private resolving = false;

  private hostApply(intent: Intent, from: string): void {
    if (this.resolving) {
      this.waiting.push([intent, from]);
      return;
    }
    const routed = router?.(intent, from, this.state);
    if (routed) {
      this.resolving = true;
      const seed = Math.floor(this.rng() * 2 ** 32);
      void routed(seed)
        .catch(() => null)
        .then((event) => {
          this.resolving = false;
          if (event && this.role === "host")
            this.hostLog({ seq: lastSeq(this.record) + 1, by: from, at: this.now(), event });
          for (const [i, f] of this.waiting.splice(0)) this.hostApply(i, f);
          this.runHooks();
        });
      return;
    }
    const resolved = resolveLogged(this.record, intent, from, this.rng, this.now(), this.state);
    if (resolved) this.hostLog(resolved);
  }

  /** Turn hooks an event set off, started one at a time once no rule is waiting (core/script.ts). */
  private hooks: [Intent, string][] = [];

  private runHooks(): void {
    while (this.hooks.length && !this.resolving && !this.state.script && this.role === "host") {
      const [intent, from] = this.hooks.shift()!;
      this.hostApply(intent, from);
    }
  }

  private hostLog(resolved: LoggedEvent): void {
    const before = this.state;
    const logged: LoggedEvent = { ...resolved, host: this.selfId };
    // The previous checkpoint's hash rides along with this event.
    const due = this.pendingCheck;
    this.pendingCheck = null;
    this.append(logged);
    const hash = due !== null ? this.checksumAt(due) : undefined;
    this.transport.send({
      t: "event",
      logged,
      ...(hash !== undefined ? { check: { seq: due!, hash } } : {}),
    });
    for (const intent of hookIntents(before, this.state, logged.event)) this.hooks.push([intent, logged.by]);
    this.runHooks();
  }

  /** Compare the host's checksum with ours at the same point. */
  private verify(check: Check): void {
    const mine = this.checksumAt(check.seq);
    if (mine === undefined || mine === check.hash) return;
    if (this.desync) return;
    this.desyncs++;
    this.desync = { seq: check.seq, count: this.desyncs, host: check.hash, mine };
    this.notify();
  }

  /** Keep the state after a checkpoint event and hash it when the browser is idle. */
  private checkpoint(logged: LoggedEvent): void {
    if (!isCheckpoint(logged.seq, logged.event)) return;
    this.checks.set(logged.seq, { state: this.state });
    if (this.checks.size > KEEP_CHECKS) this.checks.delete(this.checks.keys().next().value!);
    if (this.role === "host") this.pendingCheck = logged.seq;
    const seq = logged.seq;
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (idle) idle(() => this.checksumAt(seq));
  }

  private append(logged: LoggedEvent): void {
    this.record = appendEvent(this.record, logged);
    // Undo changes history, so rebuild; everything else folds in directly.
    this.state =
      logged.event.type === "undo"
        ? stateAt(this.record)
        : { ...applyEvent(this.state, logged.event), seq: logged.seq };
    this.checkpoint(logged);
    this.onChange(this.state, this.record);
  }

  private notify(): void {
    this.onNet?.(this.status);
  }
}
