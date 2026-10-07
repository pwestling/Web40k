import type { FromSandbox, ToSandbox } from "./protocol";

/** A call with no answer in this long stops the sandbox (perf/scripting-budget.md). */
export const WATCHDOG_MS = 250;
/** Loading packages and the first copy of the game get longer. */
export const STARTUP_MS = 5000;

/**
 * The iframe the worker starts in: no `allow-same-origin`, so it has an
 * opaque origin (no access to this page, its storage or cookies), and a CSP
 * that allows only inline and blob scripts and no network at all. A worker
 * started from a blob here inherits both.
 */
const FRAME = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:">
<script>
onmessage = (e) => {
  if (!e.data || e.data.t !== "boot" || !e.ports[0]) return;
  onmessage = null;
  const url = URL.createObjectURL(new Blob([e.data.source], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.onerror = (ev) => e.ports[0].postMessage({ id: 0, t: "error", error: "The rules sandbox didn't start: " + (ev.message || "worker error") });
  worker.postMessage(null, [e.ports[0]]);
};
</script>`;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** The app's side of the package sandbox. */
export class Sandbox {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stopped = false;

  private constructor(
    private readonly frame: HTMLIFrameElement,
    private readonly port: MessagePort,
    private readonly onStop: (why: string) => void,
  ) {
    port.onmessage = (e: MessageEvent<FromSandbox>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.t === "error") p.reject(new Error(m.error));
      else if (m.t === "ok") p.resolve(m.value);
    };
  }

  /** Start a sandbox running the bundled worker `source`; `onStop` hears why it stopped if it fails. */
  static start(source: string, onStop: (why: string) => void): Promise<Sandbox> {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.style.display = "none";
      frame.srcdoc = FRAME;
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        frame.remove();
        reject(new Error("The rules sandbox didn't start"));
      }, STARTUP_MS);
      channel.port1.onmessage = (e: MessageEvent<FromSandbox>) => {
        clearTimeout(timer);
        if (e.data.t !== "ready") {
          frame.remove();
          reject(new Error(e.data.t === "error" ? e.data.error : "The rules sandbox didn't start"));
          return;
        }
        resolve(new Sandbox(frame, channel.port1, onStop));
      };
      frame.onload = () => frame.contentWindow?.postMessage({ t: "boot", source }, "*", [channel.port2]);
      document.body.appendChild(frame);
    });
  }

  /** Ask the worker; no answer within `timeout` stops the sandbox for good. */
  call<T>(message: DistributiveOmit<ToSandbox, "id">, timeout = WATCHDOG_MS): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("The rules sandbox has stopped"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`A rules package didn't answer within ${timeout} ms`));
        this.stop(`A rules package didn't answer within ${timeout} ms, so its rules are off.`);
      }, timeout);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.port.postMessage({ ...message, id });
    });
  }

  /** Remove the iframe, which ends the worker however busy it is. */
  stop(why?: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.frame.remove();
    this.port.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("The rules sandbox has stopped"));
    }
    this.pending.clear();
    if (why) this.onStop(why);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
