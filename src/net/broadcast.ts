import type { NetMessage, Transport } from "./transport";

type Envelope =
  | { kind: "announce"; from: string }
  | { kind: "welcome"; from: string; to: string }
  | { kind: "bye"; from: string }
  | { kind: "msg"; from: string; to?: string; message: NetMessage };

/**
 * Same-browser transport over a BroadcastChannel: open the room in two tabs
 * and they play each other with no network at all. Handy for trying a game
 * alone, for development, and for browser tests where WebRTC signalling
 * relays are unreachable.
 */
export function broadcastTransport(roomId: string): Transport {
  const selfId = crypto.randomUUID().slice(0, 8);
  const channel = new BroadcastChannel(`open-battle:${roomId}`);
  const peers = new Set<string>();
  const handlers = {
    message: [] as ((m: NetMessage, from: string) => void)[],
    join: [] as ((id: string) => void)[],
    leave: [] as ((id: string) => void)[],
  };
  const post = (e: Envelope) => channel.postMessage(e);
  const meet = (id: string) => {
    if (peers.has(id)) return;
    peers.add(id);
    handlers.join.forEach((h) => h(id));
  };

  channel.onmessage = ({ data }: MessageEvent<Envelope>) => {
    if (data.from === selfId) return;
    if (data.kind === "announce") {
      post({ kind: "welcome", from: selfId, to: data.from });
      meet(data.from);
    } else if (data.kind === "welcome" && data.to === selfId) meet(data.from);
    else if (data.kind === "bye") {
      peers.delete(data.from);
      handlers.leave.forEach((h) => h(data.from));
    } else if (data.kind === "msg" && (!data.to || data.to === selfId)) {
      handlers.message.forEach((h) => h(data.message, data.from));
    }
  };
  // Announce once handlers are registered.
  setTimeout(() => post({ kind: "announce", from: selfId }), 0);
  addEventListener("beforeunload", () => post({ kind: "bye", from: selfId }));

  return {
    selfId,
    send: (message, to) => post({ kind: "msg", from: selfId, to, message }),
    onMessage: (h) => void handlers.message.push(h),
    onPeerJoin: (h) => void handlers.join.push(h),
    onPeerLeave: (h) => void handlers.leave.push(h),
    leave() {
      post({ kind: "bye", from: selfId });
      channel.close();
    },
  };
}
