import { Component, useState, type ReactNode } from "react";
import { formatDate, t } from "../i18n";
import { saveNow, useStore } from "../store";
import { reportProblem, useOpenReport, type ProblemReport } from "./report";
import { SavedNote } from "./SavedNote";

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
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="panel crash" role="alert">
      <h2>{t("Something went wrong")}</h2>
      <p>{t("Your game is saved. You can go back to it, or reload and pick it up from the start screen.")}</p>
      <p className="muted small">
        {t(
          "A problem report helps fix this: it holds the game so far and what broke, and it stays on your device until you send it to someone.",
        )}
      </p>
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            void reportProblem(error).then(setSent);
          }}
        >
          {sent ? t("Downloaded ✓") : t("Download a problem report")}
        </button>
        <button onClick={onRetry}>{t("Back to the game")}</button>
        <button onClick={() => location.reload()}>{t("Reload")}</button>
      </div>
      {/* i18n-ignore: a kind, not text */}
      {sent && <SavedNote file={sent} kind="report" />}
      <details>
        <summary className="muted small">{t("What broke")}</summary>
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
      <strong>{t("Problem report")}</strong>
      <span className="small">
        {report.error ? report.error.message : t("Reported by a player")} ·{" "}
        {t("build {build}", { build: report.build })} · {report.role ?? "?"}, {report.mode ?? "?"} ·{" "}
        {formatDate(new Date(report.at), {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        })}
      </span>
      <div className="row">
        <button onClick={() => useStore.getState().setScrub(report.seq)}>
          {t("Go to the report (event {seq})", { seq: report.seq })}
        </button>
        <button className="quiet" onClick={() => useOpenReport.setState({ report: null })}>
          ✕
        </button>
      </div>
    </div>
  );
}
