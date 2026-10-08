import { create } from "zustand";

/**
 * The service worker (src/sw/sw.template.js): the app kept on the device for
 * offline play and installing, and play-by-mail notifications. A new version
 * downloads in the background and waits; the start page offers to reload into
 * it, so nobody's game changes version mid-battle (#34).
 */
export const useUpdate = create<{ ready: ServiceWorker | null }>(() => ({ ready: null }));

const supported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** One registration for the whole app: the mailbox's notifications use it too. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | null {
  if (!supported()) return null;
  return (registering ??= navigator.serviceWorker.register("./sw.js").then((reg) => {
    const waiting = () => {
      // The very first install isn't an update: there was no version before it.
      if (reg.waiting && navigator.serviceWorker.controller) useUpdate.setState({ ready: reg.waiting });
    };
    waiting();
    reg.addEventListener("updatefound", () => {
      reg.installing?.addEventListener("statechange", waiting);
    });
    // A tab left open for days still hears about new versions.
    setInterval(() => void reg.update().catch(() => {}), 60 * 60_000);
    return reg;
  }));
}
let registering: Promise<ServiceWorkerRegistration> | null = null;

/** Switch to the waiting version and reload into it. */
export function applyUpdate(): void {
  const next = useUpdate.getState().ready;
  if (!next) return location.reload();
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  next.postMessage({ t: "skip-waiting" });
}
