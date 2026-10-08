import { Component, useState, type ReactNode } from "react";
import { saveNow, useStore } from "../store";
import { reportProblem, useOpenReport, type ProblemReport } from "./report";

/**
 * When something in the app breaks, the game is saved and the player gets a
 * way back and a problem report to pass on, instead of a white screen
 * (playtest kit, roadmap #21).
 */
export class CrashGuard extends Component<{ children: ReactNode }, { error: ProblemReport["error"] | null }> {
  state: { error: ProblemReport["error"] | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error));
    return { error: { message: e.message, ...(e.stack ? { stack: e.stack } : {}) } };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    try {
      saveNow();
    } catch {
      // Saving is best effort: the report below carries the whole game anyway.
    }
    console.error("Open Battle crashed:", error);
    this.setState((s) => ({
      error: s.error
        ? { ...s.error, ...(info.componentStack ? { component: info.componentStack } : {}) }
        : s.error,
    }));
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen error={error} onRetry={() => this.setState({ error: null })} />;
  }
}

function CrashScreen({
  error,
  onRetry,
}: {
  error: NonNullable<ProblemReport["error"]>;
  onRetry: () => void;
}) {
  const [sent, setSent] = useState(false);
  return (
    <div className="panel crash" role="alert">
      <h2>Something went wrong</h2>
      <p>Your game is saved. You can go back to it, or reload and pick it up from the start screen.</p>
      <p className="muted small">
        A problem report helps fix this: it holds the game so far and what broke, and it stays on your device
        until you send it to someone.
      </p>
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            void reportProblem(error);
            setSent(true);
          }}
        >
          {sent ? "Downloaded ✓" : "Download a problem report"}
        </button>
        <button onClick={onRetry}>Back to the game</button>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
      <details>
        <summary className="muted small">What broke</summary>
        <pre className="small">{error.message}</pre>
      </details>
    </div>
  );
}

/** Over a problem report in the replay viewer: what broke, and a way back to that moment. */
export function ReportBanner() {
  const report = useOpenReport((s) => s.report);
  const session = useStore((s) => s.session);
  if (!report || session) return null;
  return (
    <div className="panel report-banner" role="status">
      <strong>Problem report</strong>
      <span className="small">
        {report.error ? report.error.message : "Reported by a player"} · build {report.build} ·{" "}
        {report.role ?? "?"}, {report.mode ?? "?"} · {new Date(report.at).toLocaleString()}
      </span>
      <div className="row">
        <button onClick={() => useStore.getState().setScrub(report.seq)}>
          Go to the report (event {report.seq})
        </button>
        <button className="quiet" onClick={() => useOpenReport.setState({ report: null })}>
          ✕
        </button>
      </div>
    </div>
  );
}
