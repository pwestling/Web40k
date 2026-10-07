// A tiny signalling relay for Open Battle. Browsers use it only to find each
// other and set up WebRTC; game data then flows directly between them.
//
//   pnpm relay              # listens on port 8787 (or $PORT)
//
// Then open the app with ?signal=ws://localhost:8787 (or wss://your-host for
// a deployed relay; an https page needs wss://, so put it behind TLS).
import { createWsRelayServer } from "@trystero-p2p/ws-relay/server";

const port = Number(process.env.PORT ?? 8787);
const relay = createWsRelayServer({ port, onError: (err) => console.error(err) });
await relay.ready;
console.log(`Open Battle relay listening on ws://localhost:${port}`);
