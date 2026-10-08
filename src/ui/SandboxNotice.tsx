import { useEffect, useState } from "react";
import { t } from "../i18n";
import { retrySandbox, usePackageSandbox, useSandbox } from "../sandbox/runtime";

/** Rules taking this long to come up get a note and a Retry, never silence (PX playtest item 7). */
const SLOW_MS = 12_000;

/** Runs the game's trusted rules packages, and says so, with a Retry, when they stop or are slow to start. */
export function SandboxNotice() {
  usePackageSandbox();
  const error = useSandbox((s) => s.error);
  const status = useSandbox((s) => s.status);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== "starting") return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [status]);
  const retry =
    status === "stopped" || (status === "starting" && slow) ? (
      <button className="primary small" onClick={retrySandbox}>
        {t("Retry")}
      </button>
    ) : null;
  if (status === "starting" && slow)
    return (
      <div className="panel sandbox-notice" role="status">
        {t("The game's rules are still loading.")} {retry}
      </div>
    );
  if (!error) return null;
  return (
    <div className="panel sandbox-notice" role="status">
      {error} {retry}{" "}
      <button onClick={() => useSandbox.setState({ error: null })} aria-label={t("Dismiss")}>
        ✕
      </button>
    </div>
  );
}
