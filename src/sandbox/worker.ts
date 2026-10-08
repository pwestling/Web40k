import { SandboxEngine } from "./engine";
import type { FromSandbox, ToSandbox } from "./protocol";

/**
 * The package sandbox's worker. It is started from a blob inside a sandboxed
 * iframe (an opaque origin with a CSP that blocks the network), so package
 * code can't reach the app's storage, cookies or the network. The app talks
 * to it over the MessagePort it is handed first.
 */
const engine = new SandboxEngine(async (source) => {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as { default?: unknown };
  } finally {
    URL.revokeObjectURL(url);
  }
});

function serve(port: MessagePort) {
  const reply = (m: FromSandbox) => port.postMessage(m);
  port.onmessage = async (e: MessageEvent<ToSandbox>) => {
    const m = e.data;
    try {
      switch (m.t) {
        case "load":
          return reply({ id: m.id, t: "ok", value: await engine.load(m.packages) });
        case "init":
          engine.init(m.record);
          return reply({ id: m.id, t: "ok" });
        case "events":
          engine.events(m.events);
          return reply({ id: m.id, t: "ok" });
        case "resolve":
          return reply({ id: m.id, t: "ok", value: engine.resolve(m.intent, m.from, m.seed) });
        case "actions":
          return reply({ id: m.id, t: "ok", value: engine.unitActions(m.unitId, m.player) });
        case "appState":
          return reply({ id: m.id, t: "ok", value: engine.appState() });
        case "bot":
          return reply({ id: m.id, t: "ok", value: engine.botMove(m.level, m.seat, m.player, m.seed) });
        case "importRoster":
          return reply({ id: m.id, t: "ok", value: await engine.importRoster(m.fileName, m.data) });
      }
    } catch (err) {
      reply({ id: m.id, t: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };
  reply({ id: 0, t: "ready" });
}

self.onmessage = (e: MessageEvent) => {
  const port = e.ports[0];
  if (port) {
    self.onmessage = null;
    serve(port);
  }
};
