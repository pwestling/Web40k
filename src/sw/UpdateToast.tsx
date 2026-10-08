import { useState, useSyncExternalStore } from "react";
import { applyUpdate, useUpdate } from "./register";

/** On the start page only, never mid-game: a new version is ready (#34). */
export function UpdateToast() {
  const ready = useUpdate((s) => s.ready);
  const [later, setLater] = useState(false);
  if (!ready || later) return null;
  return (
    <div className="panel saved-toast update-toast" role="status">
      <span>A new version of Open Battle is ready.</span>
      <button className="primary" onClick={applyUpdate}>
        Reload
      </button>
      <button className="quiet" onClick={() => setLater(true)}>
        Later
      </button>
    </div>
  );
}

/** Says so on the start page when there's no network, and what still works. */
export function OfflineNote() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="offline-note small" role="status">
      You're offline. Games on this screen, against the computer, lessons, replays, your shelves and campaigns
      all still work.
    </p>
  );
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (on) => {
      window.addEventListener("online", on);
      window.addEventListener("offline", on);
      return () => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", on);
      };
    },
    () => navigator.onLine,
  );
}
