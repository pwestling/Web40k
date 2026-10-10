import { describe, expect, it } from "vitest";
import { RTCPeerConnection } from "./webrtc.mjs";

const gathered = (pc: RTCPeerConnection) =>
  new Promise<void>((done) => {
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
const plain = (d: RTCPeerConnection["localDescription"]) => ({ type: d!.type, sdp: d!.sdp });

describe("the host server's WebRTC", () => {
  it("offers and answers the way Trystero asks a browser to", async () => {
    const a = new RTCPeerConnection({ iceServers: [] });
    const b = new RTCPeerConnection({ iceServers: [] });
    try {
      const got = new Promise<string>((done) => {
        b.ondatachannel = ({ channel }) => (channel.onmessage = (e) => done(String(e.data)));
      });
      // The handler is set after the channel, as Trystero sets it: the event must still come.
      const channel = a.createDataChannel("data");
      channel.onopen = () => channel.send("hello");
      a.onnegotiationneeded = async () => {
        await a.setLocalDescription();
        await gathered(a);
        await b.setRemoteDescription(plain(a.localDescription));
        await b.setLocalDescription();
        await gathered(b);
        await a.setRemoteDescription(plain(b.localDescription));
      };
      expect(await got).toBe("hello");
    } finally {
      a.close();
      b.close();
    }
  }, 15_000);
});
