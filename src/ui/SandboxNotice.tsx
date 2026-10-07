import { usePackageSandbox, useSandbox } from "../sandbox/runtime";

/** Runs the game's trusted rules packages, and says so when the sandbox stops one. */
export function SandboxNotice() {
  usePackageSandbox();
  const error = useSandbox((s) => s.error);
  if (!error) return null;
  return (
    <div className="panel sandbox-notice" role="status">
      {error}{" "}
      <button onClick={() => useSandbox.setState({ error: null })} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
