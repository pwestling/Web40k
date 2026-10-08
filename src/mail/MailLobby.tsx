import { useEffect, useState } from "react";
import type { MailFile } from "./file";
import { readInviteHash } from "./mailbox";
import {
  arrivals,
  forgetMailGame,
  joinFromMailbox,
  mailGames,
  receiveFile,
  resumeMailGame,
  startMailGame,
  useMail,
} from "./store";

/** The invite link last followed, so it's followed once (StrictMode mounts twice). */
let followed: string | null = null;

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
  const [arrived, setArrived] = useState<Record<string, MailFile>>({});
  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    void f().finally(() => setBusy(false));
  };

  // Opponents' turns waiting in their games' mailboxes.
  useEffect(() => {
    let live = true;
    void arrivals().then((a) => live && setArrived(a));
    return () => void (live = false);
  }, []);

  // An invite link (#mail=…) joins its game from the mailbox, opened fresh or pasted into this tab.
  useEffect(() => {
    const follow = () => {
      const box = readInviteHash();
      if (!box || followed === box.id) return;
      followed = box.id;
      history.replaceState(null, "", location.pathname + location.search);
      void joinFromMailbox(box, name);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [name]);
  return (
    <details className="fold">
      <summary>Play by mail</summary>
      <p className="muted small">
        A game that lives across days: take your turn when you can, then send it to your opponent. On a server
        with a mailbox, turns go there and open on their side; otherwise you pass a file (email, chat,
        anything). Every roll is checked on their side, and neither of you can pick the dice.
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
              if (f) run(async () => receiveFile(await f.text(), { name }));
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
                <strong className={g.yours || arrived[g.id] ? "" : "muted"}>
                  {g.yours
                    ? "your move"
                    : arrived[g.id]
                      ? "● their turn is here: your move"
                      : g.box
                        ? "waiting for their turn"
                        : "waiting for their file"}
                </strong>{" "}
                <span className="muted small">{new Date(g.at).toLocaleDateString()}</span>
              </span>
              <span className="row">
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() => {
                      const file = arrived[g.id];
                      return file ? receiveFile(JSON.stringify(file)) : resumeMailGame(g.id);
                    })
                  }
                >
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
