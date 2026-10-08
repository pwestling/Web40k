import { create } from "zustand";

/**
 * The service worker (src/sw/sw.template.js): the app kept on the device for
 * offline play and installing, and play-by-mail notifications. A new version
 * downloads in the background and waits; the start page offers to reload into
 * it, so nobody's game changes version mid-battle (#34).
 */
export const useUpdate = create<{ ready: ServiceWorker | null; install: InstallPrompt | null }>(() => ({
  ready: null,
  install: null,
}));

/** The browser's offer to install the app (Chrome, Edge, Android), held until the player asks (UX 251). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Hold the browser's install offer for the start page's quiet link. */
export function listenForInstall(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    useUpdate.setState({ install: e as InstallPrompt });
  });
  window.addEventListener("appinstalled", () => useUpdate.setState({ install: null }));
}

/** Ask the browser to install the app; its offer can be used once. */
export async function install(): Promise<void> {
  const offer = useUpdate.getState().install;
  if (!offer) return;
  useUpdate.setState({ install: null });
  await offer.prompt();
}

/** An iPhone or iPad in Safari, not yet on the home screen: installing is by hand there. */
export function installByHand(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone);
  return ios && !standalone;
}

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
