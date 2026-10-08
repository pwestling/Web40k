import { useState, useSyncExternalStore } from "react";
import { t } from "../i18n";
import { applyUpdate, install, installByHand, useUpdate } from "./register";

/** On the start page only, never mid-game: a new version is ready (#34). It sits in the page, under the pitch (UX 250). */
export function UpdateToast() {
  const ready = useUpdate((s) => s.ready);
  const [later, setLater] = useState(false);
  if (!ready || later) return null;
  return (
    <div className="update-toast row" role="status">
      <span>{t("A new version of Open Battle is ready.")}</span>
      <button className="primary" onClick={applyUpdate}>
        {t("Reload")}
      </button>
      <button className="quiet" onClick={() => setLater(true)}>
        {t("Later")}
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
      {t(
        "You're offline. Games on this screen, against the computer, lessons, replays, your shelves and campaigns all still work.",
      )}
    </p>
  );
}

/** Beside the friends' buttons when there's no network: a game hosted now waits for it (UX 249). */
export function OfflineForFriends() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="offline-note small" role="status">
      {t("You're offline. Friends can join once you're back online.")}
    </p>
  );
}

/** A quiet way to put Open Battle on the device, where the browser offers one (UX 251). */
export function InstallLink() {
  const offer = useUpdate((s) => s.install);
  const [byHand] = useState(installByHand);
  if (offer)
    return (
      <p className="small">
        <button className="link" onClick={() => void install()}>
          {t("Install Open Battle")}
        </button>{" "}
        <span className="muted">{t("to play from your home screen or desktop, even offline.")}</span>
      </p>
    );
  if (byHand)
    return (
      <p className="muted small">
        {t("To install Open Battle on this device: Share, then Add to Home Screen.")}
      </p>
    );
  return null;
}

export function useOnline(): boolean {
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
