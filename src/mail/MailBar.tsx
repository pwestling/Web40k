import { useEffect, useState } from "react";
import { useStore } from "../store";
import { waitsOn } from "../teach/coach";
import { fileName, type MailFile } from "./file";
import { acceptAnyway, receiveFile, rejectDoubt, sendTurn, setMailName, useMail } from "./store";

function download(file: MailFile): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(file);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A play-by-mail game's strip at the bottom of the table: whose move it is,
 * Send (makes the file to pass on), and Open their file. A file that doesn't
 * check out says why, and the player decides (enforcement is advisory).
 */
export function MailBar() {
  const game = useMail((s) => s.game);
  const doubt = useMail((s) => s.doubt);
  const error = useMail((s) => s.error);
  const state = useStore((s) => s.game);
  const scrub = useStore((s) => s.scrub);
  const seated = useStore((s) => s.mail !== null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const yours = !!game?.segment;

  // The tab says when it's your move, for a game left open in the background.
  useEffect(() => {
    if (!game) return;
    const was = document.title;
    document.title = yours ? "● Your move · Open Battle" : "Waiting · Open Battle";
    return () => void (document.title = was);
  }, [game, yours]);

  if (!game || !seated || scrub !== null) return null;
  const them = Object.entries(game.names).find(([p]) => p !== game.me)?.[1] || "your opponent";
  const invitation = game.segment?.index === 1;
  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    void f().finally(() => setBusy(false));
  };
  const send = () =>
    run(async () => {
      const file = await sendTurn();
      if (file) download(file);
    });
  // Mid-turn hand-offs: their turn, or a question or roll that's theirs to answer.
  const handOff = yours && !invitation && waitsOn(state, 1 - game.seat);

  return (
    <div className="panel mailbar" role="region" aria-label="Play by mail">
      {!game.names[game.me] && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) setMailName(name.trim());
          }}
        >
          <input
            value={name}
            placeholder="Your name, for your opponent"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={!name.trim()}>
            Save
          </button>
        </form>
      )}
      {doubt ? (
        <>
          <strong>{them}'s file doesn't check out</strong>
          <ul className="small">
            {doubt.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="row">
            <button onClick={rejectDoubt}>Don't open it</button>
            <button onClick={() => run(acceptAnyway)}>Open it anyway</button>
          </div>
        </>
      ) : yours ? (
        <div className="row spread wrap">
          <span>
            <strong>{invitation ? "Set up your side" : "Your move"}</strong>
            <span className="muted small">
              {" "}
              {invitation
                ? "· then send the invitation"
                : handOff
                  ? `· over to ${them} now: send your file`
                  : `· send your file to ${them} when you're done`}
            </span>
          </span>
          <button className={handOff || invitation ? "primary" : ""} disabled={busy} onClick={send}>
            {invitation ? "Send invitation" : `Send to ${them}`}
          </button>
        </div>
      ) : (
        <div className="row spread wrap">
          <span>
            <strong>Waiting for {them}</strong>
            <span className="muted small"> · open their file when it comes</span>
          </span>
          <span className="row">
            <label className="file">
              Open their file
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) run(async () => receiveFile(await f.text()));
                }}
              />
            </label>
            {game.sent && (
              <button
                className="quiet"
                title="Save the file you sent again"
                onClick={() => download(game.sent!)}
              >
                Save mine again
              </button>
            )}
          </span>
        </div>
      )}
      {error && <p className="warn small">{error}</p>}
    </div>
  );
}
