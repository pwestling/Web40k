import { joinRoom, selfId } from "@trystero-p2p/ws-relay";
import type { JsonValue } from "@trystero-p2p/nostr";
import { APP_ID } from "../net/trystero";
import type { NetMessage, Transport } from "../net/transport";
import { MY_BUILD } from "../protocol";

/**
 * The host server's half of the app, built for Node by `pnpm build:host`
 * (vite.host.config.ts) and run by server/host.mjs.
 */
export { HostServer } from "./rooms";
export type { HostServerOptions, OpenRequest, OpenResult, RoomStore } from "./rooms";
export const BUILD = MY_BUILD;

export interface RelayOptions {
  /** The signalling relays the site's players meet on (server/relay.mjs). */
  signal: string[];
  /** Node's WebRTC (node-datachannel's polyfill). */
  rtcPolyfill: unknown;
  turn?: RTCIceServer[];
}

/** Joins a room on the site's signalling relay over WebRTC, as src/net/trystero.ts does in a browser. */
export function relayTransport(room: string, opts: RelayOptions): Transport {
  const peer = joinRoom(
    {
      appId: APP_ID,
      relayConfig: { urls: opts.signal },
      rtcPolyfill: opts.rtcPolyfill as typeof RTCPeerConnection,
      ...(opts.turn?.length ? { turnConfig: opts.turn } : {}),
    },
    room,
  );
  const channel = peer.makeAction<JsonValue>("msg");
  return {
    // Trystero gives one id per process; each room is its own mesh, so that's enough.
    selfId,
    send(message, to) {
      void channel.send(message as unknown as JsonValue, to ? { target: to } : undefined);
    },
    onMessage(handler) {
      channel.onMessage = (data, { peerId }) => handler(data as unknown as NetMessage, peerId);
    },
    onPeerJoin(handler) {
      peer.onPeerJoin = handler;
    },
    onPeerLeave(handler) {
      peer.onPeerLeave = handler;
    },
    leave() {
      void peer.leave();
    },
  };
}
