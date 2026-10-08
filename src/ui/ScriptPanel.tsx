import { playerName } from "../i18n/names";
import { useEffect } from "react";
import { t } from "../i18n";
import { keepSecret, localSecret, useLocalSecrets } from "../secrets/local";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";

/**
 * A rule written as code waiting on a player (core/script.ts): its question
 * and the options, answered by the player it asks. Everyone sees what it waits on.
 * A secret choice (ctx.secret) is kept on the chooser's device and only its
 * commitment answers; a reveal (ctx.reveal) is answered by that device on its own.
 */
export function ScriptPanel() {
  const game = useGame();
  const { dispatch, scrub } = useStore();
  const canControl = useCanControl();
  const kept = useLocalSecrets((s) => s.kept);
  const waiting = game.script?.waiting;
  const mine = !!waiting && canControl(waiting.player);
  // The commitment this device made for the secret it's asked to reveal.
  const commitment = waiting?.reveal
    ? game.secrets?.[waiting.player]?.[waiting.reveal]?.commitment
    : undefined;
  const reveal = mine && commitment ? (kept[commitment] ? commitment : undefined) : undefined;
  const step = game.script?.results.length;
  useEffect(() => {
    if (!reveal || !waiting || scrub !== null) return;
    const k = localSecret(reveal)!;
    dispatch(
      { type: "script/answer", answer: JSON.stringify({ value: k.value, salt: k.salt }) },
      waiting.player,
    );
  }, [reveal, step]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!waiting || scrub !== null) return null;
  const who = playerName(game.players[waiting.player]) ?? t("A player");
  if (waiting.reveal !== undefined)
    return (
      <div className="panel script">
        <div className="label">
          <strong>{who}</strong> {t("reveals a secret")}
          {mine && !reveal && <span className="warn"> {t("(it was committed on another device)")}</span>}
        </div>
      </div>
    );
  const answer = (id: string) =>
    dispatch(
      { type: "script/answer", answer: waiting.secret !== undefined ? keepSecret(id) : id },
      waiting.player,
    );
  return (
    <div className="panel script">
      {/* The question leads with who decides (UX 90), and says so when it isn't you. */}
      <div className="label">
        <strong>{who}:</strong> {waiting.question}
        {waiting.secret !== undefined && <span className="muted"> {t("(in secret)")}</span>}
        {!mine && <span className="muted"> {t("(waiting for {name})", { name: who })}</span>}
      </div>
      <div className="chips">
        {waiting.options.map((o) => (
          <button key={o.id} disabled={!mine} onClick={() => answer(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
