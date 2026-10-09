import { useEffect, useState } from "react";
import {
  canonResult,
  rankedOver,
  rankedReady,
  rankedResultOf,
  rankedSeats,
  type RankedResult,
  type RankedState,
} from "../core/ranked";
import type { GameState } from "../core";
import { gameTitle } from "../ui/systemLabels";
import { myKey, signAsMe } from "../player/card";
import { useStore } from "../store";
import { t, tn } from "../i18n";
import { publishResult, useRating } from "./store";
import { replayHash, signingText, type SignedResult } from "./verify";

/**
 * A ranked game at the table (#65): the offer to play it ranked, the Ranked
 * chip, and at the end the result both players sign (or don't). Opt-in all
 * the way: nothing is ranked until both seated players say so, and nothing
 * counts until both sign.
 */

const gameName = (game: GameState) => gameTitle(game);

/** Play this game ranked, with this device's player key. */
export async function playRanked(): Promise<void> {
  useStore.getState().dispatch({ type: "ranked/card", key: await myKey() });
}

/** The result's signatures by seat, once both players signed. */
function bothSigned(game: GameState): SignedResult | null {
  const r = game.ranked;
  if (!r?.result) return null;
  const sigs = r.result.players.map((p) => {
    const id = Object.keys(r.keys).find((k) => r.keys[k] === p.key);
    return id ? r.sigs[id] : null;
  });
  return sigs[0] && sigs[1] ? { result: r.result, sigs: [sigs[0], sigs[1]] } : null;
}

/**
 * Whether the result in the log is this table's game: the score as the table
 * shows it, and the replay hash of the events before it. "" when it is.
 */
async function resultWrong(game: GameState): Promise<string> {
  const r = game.ranked?.result;
  if (!r) return t("No result yet");
  if ((await replayHash(useStore.getState().record)) !== r.replay)
    return t("The result doesn't match this table's game.");
  const want = rankedResultOf(game, r.replay, r.at);
  return want && canonResult(want) === canonResult(r)
    ? ""
    : t("The result doesn't match the score on the table.");
}

/**
 * Keeps a ranked game moving, on each player's screen: writes the result once
 * the battle is over, and passes it on once both have signed. Renders nothing.
 */
export function RankedKeeper() {
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const mine = !!self && !!game.ranked?.keys[self];
  const over = rankedOver(game) && rankedReady(game);
  const pending = over && mine && !game.ranked?.result;
  useEffect(() => {
    if (!pending) return;
    // The first side writes it at once; the second only if that hasn't come (they left).
    const first = rankedSeats(game)[0] === self;
    const timer = setTimeout(
      () => {
        const s = useStore.getState();
        if (s.game.ranked?.result) return;
        void replayHash(s.record).then((replay) => {
          const result = rankedResultOf(useStore.getState().game, replay, Date.now());
          if (result) useStore.getState().dispatch({ type: "ranked/result", result });
        });
      },
      first ? 0 : 8000,
    );
    return () => clearTimeout(timer);
  }, [pending, game, self]);
  const signed = mine ? bothSigned(game) : null;
  const replay = signed?.result.replay;
  useEffect(() => {
    if (signed) void publishResult(signed);
    // Once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);
  return null;
}

/** "Play this game ranked?", to a seated player whose opponent offered it. */
export function RankedOffer() {
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const [no, setNo] = useState(false);
  const r = game.ranked;
  if (!self || typeof game.players[self]?.seat !== "number" || r?.result || rankedOver(game)) return null;
  const others = Object.keys(r?.keys ?? {}).filter((p) => p !== self && game.players[p]);
  if (r?.keys[self])
    return (
      <div className="claim ranked-offer small">
        {rankedReady(game)
          ? t("Ranked game: once you both sign the result, it counts on the {game} ladder.", {
              game: gameName(game),
            })
          : t("You play this game ranked. Waiting for your opponent to say yes.")}{" "}
        <button
          className="quiet small"
          onClick={() => useStore.getState().dispatch({ type: "ranked/card", key: null })}
        >
          {t("Unranked")}
        </button>
      </div>
    );
  if (!others.length || no) return null;
  return (
    <div className="claim ranked-offer">
      <p>
        {t(
          "{name} wants to play this game ranked. At the end you both sign the result, and it counts on the {game} ladder.",
          {
            name: game.players[others[0]!]!.name,
            game: gameName(game),
          },
        )}
      </p>
      <div className="row">
        <button className="primary" onClick={() => void playRanked()}>
          {t("Play ranked")}
        </button>
        <button onClick={() => setNo(true)}>{t("Not this time")}</button>
      </div>
    </div>
  );
}

/** "Ranked" in the top bar while both players play it so. */
export function RankedChip() {
  const ready = useStore((s) => rankedReady(s.game));
  if (!ready) return null;
  return (
    <span className="ranked-chip small" title={t("Both players play this game ranked")}>
      {t("Ranked")}
    </span>
  );
}

function scoreLine(r: RankedResult): string {
  const [a, b] = r.players;
  return r.winner === null
    ? t("{a} {va} – {vb} {b}, a draw", { a: a.name, va: a.vp, vb: b.vp, b: b.name })
    : t("{a} {va} – {vb} {b}, {winner} wins", {
        a: a.name,
        va: a.vp,
        vb: b.vp,
        b: b.name,
        winner: r.players[r.winner].name,
      });
}

/** At the end of a ranked game: the result to sign, then whether it counts. */
export function RankedSign() {
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const ranked: RankedState | undefined = game.ranked;
  const result = ranked?.result;
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = self ? ranked?.keys[self] : undefined;
  const rating = useRating(me, result?.system);
  useEffect(() => {
    let live = true;
    if (result) void resultWrong(useStore.getState().game).then((w) => live && setWrong(w));
    return () => {
      live = false;
    };
  }, [result]);
  if (!ranked || !rankedReady(game) || !rankedOver(game)) return null;
  if (!result)
    return <div className="panel-note ranked-sign muted">{t("Writing up the ranked result…")}</div>;
  const declined = Object.entries(ranked.sigs).find(([, s]) => s === null);
  if (declined)
    return (
      <div className="panel-note ranked-sign">
        <strong>{t("Not ranked")}</strong>{" "}
        {t("{name} didn't sign the result, so this game doesn't count.", {
          name: game.players[declined[0]]?.name ?? "?",
        })}
      </div>
    );
  const done = bothSigned(game);
  if (done)
    return (
      <div className="panel-note ranked-sign good">
        <strong>{t("Ranked result signed")}</strong> {scoreLine(result)}.{" "}
        {rating
          ? tn(
              rating.games,
              "You're now {rating} on the {game} ladder ({n} game).",
              "You're now {rating} on the {game} ladder ({n} games).",
              { rating: rating.rating, game: gameName(game) },
            )
          : t("It counts on the {game} ladder.", { game: gameName(game) })}
      </div>
    );
  const signedByMe = !!self && self in ranked.sigs;
  const sign = async (agree: boolean) => {
    setBusy(true);
    const canon = canonResult(result);
    const sig = agree && canon ? await signAsMe(signingText(canon)) : null;
    useStore.getState().dispatch({ type: "ranked/sign", sig });
    setBusy(false);
  };
  return (
    <div className="panel-note ranked-sign">
      <strong>{t("Sign the ranked result")}</strong> {scoreLine(result)}.
      {wrong ? <p className="warn small">{wrong}</p> : null}
      {!me ? null : signedByMe ? (
        <p className="muted small">{t("Signed. Waiting for your opponent to sign.")}</p>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy || wrong !== ""} onClick={() => void sign(true)}>
            {t("Sign: that's right")}
          </button>
          <button disabled={busy} onClick={() => void sign(false)}>
            {t("Don't sign")}
          </button>
        </div>
      )}
      <p className="muted small">
        {t(
          "A game counts only when both players sign. Not signing means it doesn't count for either of you.",
        )}
      </p>
    </div>
  );
}
