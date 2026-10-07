import type { NetMessage, Transport } from "./transport";

type Handlers = {
  message: ((m: NetMessage, from: string) => void)[];
  join: ((id: string) => void)[];
  leave: ((id: string) => void)[];
};

/** An in-memory network of transports. Messages are delivered synchronously
 * and deep-copied so peers never share object references. */
export function createLoopbackNetwork() {
  const peers = new Map<string, Handlers>();

  function connect(id: string): Transport {
    const handlers: Handlers = { message: [], join: [], leave: [] };
    const others = [...peers.keys()];
    peers.set(id, handlers);
    // Announce after the caller has had a chance to register handlers.
    queueMicrotask(() => {
      for (const other of others) {
        peers.get(other)?.join.forEach((h) => h(id));
        handlers.join.forEach((h) => h(other));
      }
    });

    return {
      selfId: id,
      send(message, to) {
        const targets = to ? [to] : [...peers.keys()].filter((p) => p !== id);
        for (const target of targets) {
          const copy = structuredClone(message);
          peers.get(target)?.message.forEach((h) => h(copy, id));
        }
      },
      onMessage: (h) => void handlers.message.push(h),
      onPeerJoin: (h) => void handlers.join.push(h),
      onPeerLeave: (h) => void handlers.leave.push(h),
      leave() {
        peers.delete(id);
        for (const other of peers.values()) other.leave.forEach((h) => h(id));
      },
    };
  }

  return { connect };
}
