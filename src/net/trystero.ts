import { joinRoom, selfId, type JsonValue } from "@trystero-p2p/nostr";
import type { NetMessage, Transport } from "./transport";

const APP_ID = "open-battle-dev";

/**
 * WebRTC transport. Trystero finds peers through public Nostr relays (only
 * the WebRTC handshake goes through them); game data then flows directly
 * between browsers. No server of our own is needed.
 */
export function trysteroTransport(roomId: string, password?: string): Transport {
  const room = joinRoom({ appId: APP_ID, password }, roomId);
  const channel = room.makeAction<JsonValue>("msg");

  return {
    selfId,
    send(message, to) {
      void channel.send(message as unknown as JsonValue, to ? { target: to } : undefined);
    },
    onMessage(handler) {
      channel.onMessage = (data, { peerId }) => handler(data as unknown as NetMessage, peerId);
    },
    onPeerJoin(handler) {
      room.onPeerJoin = handler;
    },
    onPeerLeave(handler) {
      room.onPeerLeave = handler;
    },
    leave() {
      void room.leave();
    },
  };
}
