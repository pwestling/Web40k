import { joinRoom as joinNostr, selfId as nostrSelfId, type JsonValue } from "@trystero-p2p/nostr";
import { joinRoom as joinWsRelay, selfId as wsSelfId } from "@trystero-p2p/ws-relay";
import { netConfig, type NetConfig } from "./config";
import type { NetMessage, Transport } from "./transport";

export const APP_ID = "open-battle-dev";

/**
 * WebRTC transport. Trystero finds peers through a signalling relay (public
 * Nostr relays by default, or a self-hosted WebSocket relay); game data then
 * flows directly between browsers.
 */
export function trysteroTransport(
  roomId: string,
  password?: string,
  config: NetConfig = netConfig(),
): Transport {
  const turnConfig = config.turn.length ? config.turn : undefined;
  // Everything through TURN (?forceTurn=1): for testing a TURN server.
  const rtcConfig: RTCConfiguration | undefined = config.forceTurn
    ? { iceTransportPolicy: "relay" }
    : undefined;
  const room = config.signal.length
    ? joinWsRelay(
        { appId: APP_ID, password, turnConfig, rtcConfig, relayConfig: { urls: config.signal } },
        roomId,
      )
    : joinNostr(
        {
          appId: APP_ID,
          password,
          turnConfig,
          rtcConfig,
          ...(config.nostr.length ? { relayConfig: { urls: config.nostr } } : {}),
        },
        roomId,
      );
  const selfId = config.signal.length ? wsSelfId : nostrSelfId;
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
    connections: () => room.getPeers(),
    media: {
      addStream(stream, to) {
        // A peer that drops mid-negotiation rejects its promise: nothing to do but let it go.
        for (const p of room.addStream(stream, to ? { target: to } : undefined)) p.catch(() => {});
      },
      removeStream(stream, to) {
        room.removeStream(stream, to ? { target: to } : undefined);
      },
      onStream(handler) {
        room.onPeerStream = (stream, peerId) => handler(stream, peerId);
      },
    },
  };
}
