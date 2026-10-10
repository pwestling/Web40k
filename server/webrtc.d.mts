// Types for server/webrtc.mjs, for its tests (server/webrtc.test.ts). The server's
// TypeScript has no DOM types, so this names only what the tests use.
interface Description {
  type: string;
  sdp: string;
}
interface Channel {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
}
export declare class RTCPeerConnection {
  constructor(config?: { iceServers?: { urls: string | string[] }[] });
  readonly iceGatheringState: string;
  readonly localDescription: Description | null;
  ondatachannel: ((event: { channel: Channel }) => void) | null;
  onnegotiationneeded: (() => void) | null;
  addEventListener(type: string, listener: () => void): void;
  createDataChannel(label: string): Channel;
  setLocalDescription(description?: Description): Promise<void>;
  setRemoteDescription(description: Description): Promise<void>;
  close(): void;
}
