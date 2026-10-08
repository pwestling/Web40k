import { useState } from "react";
import { reportProblem } from "./report";

/** Where bug reports go: the bug form asks for the report file (.github/ISSUE_TEMPLATE). */
export const ISSUE_URL = "https://github.com/pwestling/Web40k/issues/new?template=bug_report.yml";

/**
 * After a file downloads, say where it went and where to send it (UX 171):
 * downloads land silently otherwise.
 */
export function SavedNote({ file, kind }: { file: string; kind: "report" | "feedback" }) {
  return (
    <p className="saved-note small" role="status">
      Saved <code>{file}</code> to your downloads.{" "}
      {kind === "report" ? (
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

/** "Report a problem": download the report, then say where it went. */
export function ReportButton({ className = "quiet", label = "Report a problem" }) {
  const [file, setFile] = useState<string | null>(null);
  return (
    <>
      <button
        className={className}
        title="Download one file with this game, the app's version and recent errors, to send to whoever can fix it"
        onClick={() => void reportProblem().then(setFile)}
      >
        {label}
      </button>
      {file && <SavedNote file={file} kind="report" />}
    </>
  );
}
