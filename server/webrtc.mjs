// WebRTC for the host server (server/host.mjs), from node-datachannel's
// polyfill, fixed up to behave as Trystero expects a browser to:
//
// - The polyfill never fires "negotiationneeded", and libdatachannel makes
//   its own offer the moment a data channel is created, so Trystero (which
//   makes its offer in that event's handler) never sends one. A server that
//   should lead the offer to a player then never connects to them.
// - Its setLocalDescription() ignores a call with no description, which is
//   how Trystero asks for both its offer and its answer.
//
// So: no automatic negotiation; "negotiationneeded" after the first data
// channel, as a browser fires it; and setLocalDescription() makes the offer
// or the answer, whichever the connection's state calls for.
import nodeDataChannel from "node-datachannel";
import { RTCPeerConnection as Polyfill } from "node-datachannel/polyfill";

/** ICE servers as libdatachannel takes them: turn:user:pass@host:port. */
function iceUrls(servers = []) {
  return servers.flatMap((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).map((url) => {
      if (!server.username || !server.credential) return url;
      const [protocol, rest] = url.split(/:(.*)/);
      return `${protocol}:${server.username}:${server.credential}@${rest}`;
    }),
  );
}

let count = 0;

export class RTCPeerConnection extends Polyfill {
  #native;
  #asked = false;

  constructor(config = {}) {
    const native = new nodeDataChannel.PeerConnection(`host-${++count}`, {
      ...config,
      iceServers: iceUrls(config.iceServers),
      disableAutoNegotiation: true,
    });
    super({ ...config, peerConnection: native });
    this.#native = native;
  }

  createDataChannel(label, options) {
    const channel = super.createDataChannel(label, options);
    if (!this.#asked) {
      this.#asked = true;
      setTimeout(
        () => this.signalingState !== "closed" && this.dispatchEvent(new Event("negotiationneeded")),
      );
    }
    return channel;
  }

  async setLocalDescription(description) {
    const type = description?.type ?? (this.signalingState === "have-remote-offer" ? "answer" : "offer");
    if (type === "rollback") return;
    this.#native.setLocalDescription(type);
  }
}
