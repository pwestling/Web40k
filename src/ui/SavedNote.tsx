import { useEffect } from "react";
import { create } from "zustand";
import { reportProblem } from "./report";

/** Where bug reports go: the bug form asks for the report file (.github/ISSUE_TEMPLATE). */
export const ISSUE_URL = "https://github.com/pwestling/Web40k/issues/new?template=bug_report.yml";

/**
 * After a file downloads, say where it went and where to send it (UX 171):
 * downloads land silently otherwise.
 */
export function SavedNote({ file, kind }: { file: string; kind: "report" | "feedback" | "army" | "table" }) {
  return (
    <p className="saved-note small" role="status">
      Saved <code>{file}</code> to your downloads.{" "}
      {kind === "table" ? (
        <>Send it to a friend: they add it with Open a table file, in the terrain editor's Table library.</>
      ) : kind === "army" ? (
        <>Send it to a friend: they add it with Open an army file, under Your army shelf.</>
      ) : kind === "report" ? (
        <>
          Attach it to a{" "}
          <a href={ISSUE_URL} target="_blank" rel="noreferrer">
            bug report on GitHub
          </a>
          , or send it to whoever is helping you test.
        </>
      ) : (
        <>
          Send it to whoever invited you to test, or attach it to an{" "}
          <a href="https://github.com/pwestling/Web40k/issues/new/choose" target="_blank" rel="noreferrer">
            issue on GitHub
          </a>
          .
        </>
      )}
    </p>
  );
}

/** A file just saved from a menu, shown as a toast so it doesn't crowd the menu (UX 173). */
const useSaved = create<{ file: string | null; kind: "report" | "feedback" }>(() => ({
  file: null,
  kind: "report",
}));
const TOAST_MS = 30_000;

export function SavedToast() {
  const { file, kind } = useSaved();
  useEffect(() => {
    if (!file) return;
    const t = setTimeout(() => useSaved.setState({ file: null }), TOAST_MS);
    return () => clearTimeout(t);
  }, [file]);
  if (!file) return null;
  return (
    <div className="panel saved-toast">
      <SavedNote file={file} kind={kind} />
      <button className="quiet" aria-label="Close" onClick={() => useSaved.setState({ file: null })}>
        ✕
      </button>
    </div>
  );
}

/** "Report a problem": download the report, then say where it went. */
export function ReportButton({ className = "quiet", label = "Report a problem" }) {
  return (
    <button
      className={className}
      title="Download one file with this game, the app's version and recent errors, to send to whoever can fix it"
      onClick={() => void reportProblem().then((file) => useSaved.setState({ file, kind: "report" }))}
    >
      {label}
    </button>
  );
}
