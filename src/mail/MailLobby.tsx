import { useState } from "react";
import { forgetMailGame, mailGames, receiveFile, resumeMailGame, startMailGame, useMail } from "./store";

/**
 * The lobby's "Play by mail" section: start a game that lives across days,
 * open a file from an opponent, or pick up a game already under way.
 */
export function MailLobby({
  name,
  system,
  onStarted,
}: {
  name: string;
  system: string;
  onStarted: () => void;
}) {
  const error = useMail((s) => s.error);
  const [games, setGames] = useState(mailGames);
  const [busy, setBusy] = useState(false);
  const run = (f: () => Promise<void>) => {
    setBusy(true);
    void f().finally(() => setBusy(false));
  };
  return (
    <details className="fold">
      <summary>Play by mail</summary>
      <p className="muted small">
        A game that lives across days: take your turn when you can, then send the file it makes to your
        opponent (email, chat, anything). Every roll is checked on their side, and neither of you can pick the
        dice.
      </p>
      <div className="row wrap">
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await startMailGame(name, system);
              onStarted();
            })
          }
        >
          Start a mail game
        </button>
        <label className="file">
          Open a file from your opponent
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run(async () => receiveFile(await f.text()));
            }}
          />
        </label>
      </div>
      {error && <p className="warn small">{error}</p>}
      {games.length > 0 && (
        <ul className="mail-games">
          {games.map((g) => (
            <li key={g.id} className="row spread">
              <span>
                vs {g.vs || "your opponent"} ·{" "}
                <strong className={g.yours ? "" : "muted"}>
                  {g.yours ? "your move" : "waiting for their file"}
                </strong>{" "}
                <span className="muted small">{new Date(g.at).toLocaleDateString()}</span>
              </span>
              <span className="row">
                <button disabled={busy} onClick={() => run(() => resumeMailGame(g.id))}>
                  Open
                </button>
                <button
                  className="quiet"
                  title="Remove this game from this device (the files you saved keep it)"
                  onClick={() => {
                    if (!confirm("Remove this mail game from this device?")) return;
                    forgetMailGame(g.id);
                    setGames(mailGames());
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
