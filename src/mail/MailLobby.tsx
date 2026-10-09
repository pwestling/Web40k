import { useEffect, useState } from "react";
import type { MailFile } from "./file";
import { fetchFiles, readInviteHash, type Box } from "./mailbox";
import { stateAt } from "../core";
import { unbundleReplay } from "../ui/replayFile";
import { gameTitle } from "../ui/systemLabels";
import { presetMission } from "../ui/demo";
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
import { formatDate, t } from "../i18n";

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
  // An invite link waits for the joiner's name (UX 236), prefilled with this browser's last one.
  const [invite, setInvite] = useState<Box | null>(null);
  const [joinName, setJoinName] = useState(name);
  // Who invites you to what, read from the invitation in the mailbox (UX 405).
  const [about, setAbout] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!invite) return;
    let live = true;
    void inviteText(invite).then((text) => live && text && setAbout({ id: invite.id, text }));
    return () => void (live = false);
  }, [invite]);
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
      setInvite(box);
      setJoinName((n) => n || localStorage.getItem("open-battle:name") || "");
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  const join = () => {
    if (!invite) return;
    const who = joinName.trim();
    if (who) localStorage.setItem("open-battle:name", who);
    setInvite(null);
    run(() => joinFromMailbox(invite, who || undefined));
  };
  return (
    <>
      {invite && (
        <div className="modal-backdrop">
          <form
            className="panel modal invite-name"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <strong>
              {(about?.id === invite.id && about.text) || t("You've been invited to a game by mail")}
            </strong>
            <label className="row">
              {t("Your name, for your opponent")}{" "}
              <input
                autoFocus
                aria-label={t("Your name, for your opponent")}
                value={joinName}
                placeholder={t("Your name")}
                onChange={(e) => setJoinName(e.target.value)}
              />
            </label>
            <div className="row">
              <button className="primary" disabled={busy || !joinName.trim()}>
                {t("Join the game")}
              </button>
              <button type="button" onClick={() => setInvite(null)}>
                {t("Not now")}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Open when something went wrong (a link whose mailbox can't be reached), so it's seen. */}
      <details className="fold" open={error ? true : undefined}>
        <summary>{t("Play by mail")}</summary>
        <p className="muted small">
          {t(
            "A game that lives across days: take your turn when you can, then send it to your opponent. On a server with a mailbox, turns go there and open on their side; otherwise you pass a file (email, chat, anything). Every roll is checked on their side, and neither of you can pick the dice.",
          )}
        </p>
        <div className="row wrap">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await startMailGame(name, system);
                // The game's first mission, as every other way in starts with (UX 394).
                presetMission();
                onStarted();
              })
            }
          >
            {t("Start a mail game")}
          </button>
          <label className="file">
            {t("Open a file from your opponent")}
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
                  {t("vs {name}", { name: g.vs || t("your opponent") })} ·{" "}
                  <strong className={g.yours || arrived[g.id] ? "" : "muted"}>
                    {g.yours
                      ? t("your move")
                      : arrived[g.id]
                        ? t("● their turn is here: your move")
                        : g.box
                          ? t("waiting for their turn")
                          : t("waiting for their file")}
                  </strong>{" "}
                  <span className="muted small">{formatDate(new Date(g.at))}</span>
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
                    {t("Open")}
                  </button>
                  <button
                    className="quiet"
                    title={t("Remove this game from this device (the files you saved keep it)")}
                    onClick={() => {
                      if (!confirm(t("Remove this mail game from this device?"))) return;
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
    </>
  );
}

/** "Ana invites you to Sci-fi battle (1 vs 1, Crossfire)", from the invitation in the mailbox, or null. */
async function inviteText(box: Box): Promise<string | null> {
  try {
    const file = (await fetchFiles(box, 0))?.find((f) => f.index === 1);
    if (!file?.record) return null;
    const s = stateAt(await unbundleReplay(file.record));
    const size = (s.settings.teamSize ?? 1) > 1 ? t("2 vs 2") : t("1 vs 1");
    const p = { name: file.name, game: gameTitle(s), size, mission: s.mission?.name ?? "" };
    return s.mission
      ? t("{name} invites you to {game} ({size} · {mission})", p)
      : t("{name} invites you to {game} ({size})", p);
  } catch {
    return null;
  }
}
