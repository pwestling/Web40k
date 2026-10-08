import "../systems";
import { soak } from "../soak/run";
import { readManifest } from "../packages/manifest";
import { SandboxEngine } from "../sandbox/engine";
import type { FromSandbox, ToSandbox } from "../sandbox/protocol";

/**
 * The module workshop's soak bot (#41): plays a whole bot game of a draft
 * package over loopback peers and reports what went wrong, and loads a draft
 * on each save to check it before it reaches the test table. It runs like the
 * package sandbox, from a blob in a sandboxed iframe with no network, since
 * the draft's code is as untrusted as any package's.
 */
const importSource = async (source: string) => {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as { default?: unknown };
  } finally {
    URL.revokeObjectURL(url);
  }
};

function serve(port: MessagePort) {
  const reply = (m: FromSandbox) => port.postMessage(m);
  port.onmessage = async (e: MessageEvent<ToSandbox>) => {
    const m = e.data;
    if (m.t === "check") {
      // A fresh engine each time: the draft loads exactly as the test table would load it.
      try {
        const loaded = await new SandboxEngine(importSource).load([{ hash: "draft", source: m.source }]);
        return reply({ id: m.id, t: "ok", value: loaded });
      } catch (err) {
        return reply({ id: m.id, t: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (m.t !== "soak") return reply({ id: m.id, t: "error", error: `not a soak call: ${m.t}` });
    try {
      const read = readManifest(m.source);
      if ("error" in read) throw new Error(read.error);
      const system = read.manifest.systems[0] ?? "";
      const report = await soak({ system, seed: m.seed, systemPkg: { source: m.source, importSource } });
      reply({ id: m.id, t: "ok", value: report });
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
