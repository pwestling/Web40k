import { useEffect, useState } from "react";
import { useStore } from "../store";
import { waitsOn } from "../teach/coach";
import { fileName, type MailFile } from "./file";
import { inviteLink, pushKey, pushSupported, subscribePush } from "./mailbox";
import {
  acceptAnyway,
  checkMailbox,
  postAgain,
  receiveFile,
  rejectDoubt,
  sendTurn,
  setMailName,
  setPush,
  useMail,
} from "./store";
import { t } from "../i18n";

/** How often a waiting game looks in its mailbox while the page is open. */
const POLL_MS = 30_000;

function download(file: MailFile): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(file);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** On a phone, hand the file to the share sheet (mail, chat); elsewhere, or if that fails, save it. */
async function passOn(file: MailFile, to: string): Promise<"shared" | "saved"> {
  const touch = matchMedia?.("(pointer: coarse)").matches;
  const f = new File([JSON.stringify(file)], fileName(file), { type: "application/json" });
  if (touch && navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title: t("Open Battle: your move, {name}", { name: to }) });
      return "shared";
    } catch {
      // Cancelled or refused: save it instead.
    }
  }
  download(file);
  return "saved";
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
  // What happened to the file we just made, said on the strip until their file comes.
  const [passed, setPassed] = useState<{ file: string; how: "shared" | "saved"; invite: boolean } | null>(
    null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [pushBox, setPushBox] = useState<string | null>(null);
  const yours = !!game?.segment;
  const box = game?.box ?? null;
  const waiting = !!game && !yours && !doubt;

  // While we wait, look in the mailbox now, every so often, and whenever the page comes back into view.
  useEffect(() => {
    if (!box || !waiting) return;
    const look = () => void (document.visibilityState === "visible" && checkMailbox());
    look();
    const timer = setInterval(look, POLL_MS);
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
    };
  }, [box, waiting]);

  // Offer notifications only when the mailbox sends them and this browser can show them.
  useEffect(() => {
    if (!box || !pushSupported()) return;
    let live = true;
    void pushKey(box).then((k) => live && k && setPushBox(box.id));
    return () => void (live = false);
  }, [box]);
  const canPush = !!box && pushBox === box.id;

  // The tab says when it's your move, for a game left open in the background.
  useEffect(() => {
    if (!game) return;
    const was = document.title;
    document.title = yours ? t("● Your move · Open Battle") : t("Waiting · Open Battle");
    return () => void (document.title = was);
  }, [game, yours]);

  if (!game || !seated || scrub !== null) return null;
  const them = Object.entries(game.names).find(([p]) => p !== game.me)?.[1] || t("your opponent");
  const invitation = game.segment?.index === 1;
  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    void f().finally(() => setBusy(false));
  };
  const send = () =>
    run(async () => {
      setNote(null);
      const file = await sendTurn();
      // With a mailbox, the file only needs passing on when the mailbox can't be reached.
      if (file && box && useMail.getState().game?.posted) setPassed(null);
      else if (file)
        setPassed({ file: fileName(file), how: await passOn(file, them), invite: file.index === 1 });
    });
  // Before the battle: each side sets up, and the one who made the game starts it.
  const setup = state.turn.round === 0;
  const creator = game.me === "p1";
  const notify = () =>
    run(async () => {
      const why = await subscribePush(box!, game.me);
      if (why) setNote(why);
      else {
        setPush(true);
        setNote(t("This browser will tell you when it's your move."));
      }
    });
  const copyLink = () => {
    const link = inviteLink(box!);
    void navigator.clipboard?.writeText(link).then(
      () => setNote(t("Invite link copied. Send it to your opponent.")),
      () => setNote(link),
    );
  };
  // Mid-turn hand-offs: their turn, or a question or roll that's theirs to answer.
  const handOff = yours && !invitation && waitsOn(state, 1 - game.seat);

  return (
    <div className="panel mailbar" role="region" aria-label={t("Play by mail")}>
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
            placeholder={t("Your name, for your opponent")}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={!name.trim()}>
            {t("Save")}
          </button>
        </form>
      )}
      {doubt ? (
        <>
          <strong>{t("{name}'s file doesn't check out", { name: them })}</strong>
          <span className="small muted">
            {t(
              "Open it anyway plays it into your game as it is, as if it had checked out. Don't open it leaves your game as it was; ask {name} to send it again.",
              { name: them },
            )}
          </span>
          <ul className="small">
            {doubt.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="row">
            <button onClick={rejectDoubt}>{t("Don't open it")}</button>
            <button onClick={() => run(acceptAnyway)}>{t("Open it anyway")}</button>
          </div>
        </>
      ) : yours ? (
        <div className="row spread wrap">
          <span>
            <strong>{invitation || (setup && !creator) ? t("Set up your side") : t("Your move")}</strong>
            <span className="muted small">
              {" "}
              {invitation
                ? t("· then send the invitation")
                : setup && !creator
                  ? t("· then send it back to {name}, who starts the battle when they have your file", {
                      name: them,
                    })
                  : setup
                    ? t(
                        "· start the battle (▶ at the top) when you're ready, then send your file to {name}",
                        {
                          name: them,
                        },
                      )
                    : handOff
                      ? t("· over to {name} now: send your file", { name: them })
                      : t("· send your file to {name} when you're done", { name: them })}
            </span>
          </span>
          <button
            className={handOff || invitation || (setup && !creator) ? "primary" : ""}
            disabled={busy}
            onClick={send}
          >
            {invitation ? t("Send invitation") : t("Send to {name}", { name: them })}
          </button>
        </div>
      ) : (
        <>
          <div className="row spread wrap">
            <span>
              <strong>{t("Waiting for {name}", { name: them })}</strong>
              <span className="muted small">
                {box && game.posted
                  ? game.sent?.index === 1
                    ? t(" · the invitation is in the game's mailbox: send them the link")
                    : t(" · your turn is in the game's mailbox; theirs will open here when it comes")
                  : t(" · open their file when it comes")}
              </span>
              {passed && (
                <span className="small mail-passed">
                  {passed.how === "shared"
                    ? t("Sent {file}. ", { file: passed.file })
                    : t("Saved {file} to your downloads: send it to {name} by email, chat or anything. ", {
                        file: passed.file,
                        name: them,
                      })}
                  {passed.invite
                    ? t("They open it from the lobby, under Play by mail.")
                    : t("They open it with Open their file.")}
                </span>
              )}
            </span>
            <span className="row">
              {box && game.sent?.index === 1 && game.posted && (
                <button className="primary" onClick={copyLink}>
                  {t("Copy invite link")}
                </button>
              )}
              <label className="file">
                {t("Open their file")}
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
                  title={t("Save the file you sent, to pass it on by hand")}
                  onClick={() => download(game.sent!)}
                >
                  {box && game.posted ? t("Save as a file") : t("Save mine again")}
                </button>
              )}
            </span>
          </div>
          {box && game.sent && !game.posted && (
            <div className="row wrap">
              <span className="warn small">
                {t("The game's mailbox couldn't be reached, so pass your file on by hand.")}
              </span>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => run(async () => (await postAgain()) && setPassed(null))}
              >
                {t("Try the mailbox again")}
              </button>
            </div>
          )}
          {box && game.posted && canPush && !game.push && (
            <div className="row wrap">
              <span className="muted small">
                {t("Or leave this tab: the title says when it's your move.")}
              </span>
              <button className="quiet" disabled={busy} onClick={notify}>
                {t("Notify me when it's my move")}
              </button>
            </div>
          )}
        </>
      )}
      {note && waiting && <p className="small">{note}</p>}
      {error && <p className="warn small">{error}</p>}
    </div>
  );
}
