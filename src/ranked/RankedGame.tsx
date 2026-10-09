import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  canonResult,
  MAX_FIXES,
  rankedOver,
  rankedReady,
  rankedResultOf,
  rankedSeats,
  type DeclineWhy,
  type RankedResult,
  type RankedState,
} from "../core/ranked";
import type { GameState } from "../core";
import { gameTitle, systemTitle } from "../ui/systemLabels";
import { myKey, signAsMe } from "../player/card";
import { useStore } from "../store";
import { formatNumber, t, tn } from "../i18n";
import { say } from "../talk/talk";
import { change, PROVISIONAL } from "./ratings";
import { publishResult, useRankedResults, useRatingMove } from "./store";
import { declineText, replayHash, signingText, type DeclinedResult, type SignedResult } from "./verify";

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

/** The result one player signed and the other declined (with their signed refusal), to pass on for the sign rate. */
function declinedOf(game: GameState): DeclinedResult | null {
  const r = game.ranked;
  if (!r?.result) return null;
  const ids = r.result.players.map((p) => Object.keys(r.keys).find((k) => r.keys[k] === p.key));
  const seat = ids.findIndex((id) => !!id && r.sigs[id] === null);
  if (seat !== 0 && seat !== 1) return null;
  const signer = ids[1 - seat];
  const sig = signer ? r.sigs[signer] : null;
  const why = r.whys?.[ids[seat]!];
  const refusal = r.declines?.[ids[seat]!];
  if (!sig || !refusal || !why || why === "score") return null;
  return {
    result: r.result,
    sigs: seat === 0 ? [null, sig] : [sig, null],
    declined: { seat, why, sig: refusal },
  };
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
  const pending = over && mine && !game.ranked?.result && !game.ranked?.fixing;
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
  const signed = mine ? (bothSigned(game) ?? declinedOf(game)) : null;
  const replay = signed?.result.replay;
  const kind = signed ? ("declined" in signed ? "declined" : "signed") : null;
  useEffect(() => {
    if (signed) void publishResult(signed);
    // Once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, kind]);
  return null;
}

/** "Not this time" to the ranked offer, for this room (the arrival card and the panel share it). */
const useNotRanked = create<{ room: string | null }>(() => ({ room: null }));
export const notRanked = () => useNotRanked.setState({ room: useStore.getState().roomId ?? "" });

/** Whose ranked offer this player hasn't answered yet: the opponent's id, or null. */
export function useRankedAsk(): string | null {
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const no = useNotRanked((s) => s.room !== null && s.room === (useStore.getState().roomId ?? ""));
  const r = game.ranked;
  if (no || !self || typeof game.players[self]?.seat !== "number" || r?.result || rankedOver(game))
    return null;
  if (r?.keys[self]) return null;
  return Object.keys(r?.keys ?? {}).find((p) => p !== self && game.players[p]) ?? null;
}

/** "Play this game ranked?", to a seated player whose opponent offered it. */
export function RankedOffer() {
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const no = useNotRanked((s) => s.room !== null && s.room === (useStore.getState().roomId ?? ""));
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
        <button onClick={notRanked}>{t("Not this time")}</button>
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

const withSign = (n: number) => (n > 0 ? `+${formatNumber(n)}` : n < 0 ? `−${formatNumber(-n)}` : "±0");

/** Why the number moved as it did (PX ranked 2): who it was against, and what a game is worth. */
function whyItMoved(score: 0 | 0.5 | 1, me: number, them: number, delta: number): string {
  const n = formatNumber(Math.abs(delta));
  const gap = them - me;
  if (Math.abs(gap) < 50)
    return score === 1
      ? t("Against an even opponent a win gains {n}.", { n })
      : score === 0
        ? t("Against an even opponent a loss costs {n}; beat a stronger player and you gain more.", { n })
        : t("A draw between even players moves little.");
  if (gap > 0)
    return score === 1
      ? t("Beating a stronger player gains more: {n}.", { n })
      : score === 0
        ? t("Losing to a stronger player costs less: {n}.", { n })
        : t("A draw against a stronger player gains you {n}.", { n });
  return score === 1
    ? t("Beating a lower-rated player gains less: {n}.", { n })
    : score === 0
      ? t("Losing to a lower-rated player costs more: {n}.", { n })
      : t("A draw against a lower-rated player costs you {n}.", { n });
}

/** "Still finding your level: 3 more games" while a rating is provisional (PX ranked 4). */
export function settling(games: number): string | null {
  return games < PROVISIONAL
    ? tn(
        PROVISIONAL - games,
        "Still finding your level: {n} more game.",
        "Still finding your level: {n} more games.",
      )
    : null;
}

/** The signed ending for a player: the new rating, the change, why, and something to play for. */
function RatingLine({ result, me }: { result: RankedResult; me: string }) {
  const results = useRankedResults();
  const move = useRatingMove(me, result.system, result.replay);
  const seat = result.players.findIndex((p) => p.key === me);
  if (seat < 0) return null;
  const game = systemTitle(result.system);
  if (!move)
    return results[result.replay] ? (
      <p className="small">
        {t("You two have played three ranked games today, so this one doesn't move the {game} ladder.", {
          game,
        })}
      </p>
    ) : (
      <p className="small">{t("It counts on the {game} ladder.", { game })}</p>
    );
  const score = result.winner === null ? 0.5 : result.winner === seat ? 1 : 0;
  const back = Math.round(change(move.after, move.them.rating, 1));
  return (
    <>
      <p className="rating-move">
        {t("You're now {rating} ({change}) on the {game} ladder.", {
          rating: formatNumber(move.after),
          change: withSign(move.delta),
          game,
        })}
      </p>
      <p className="muted small">
        {whyItMoved(score, move.before, move.them.rating + move.delta, move.delta)}{" "}
        {score === 0
          ? t("A win against {name} wins back {n}.", { name: move.them.name, n: formatNumber(back) })
          : null}{" "}
        {settling(move.games)}
      </p>
    </>
  );
}

const WHY_LINES: Record<DeclineWhy, () => string> = {
  score: () => t("The score is wrong"),
  agreed: () => t("We agreed it wouldn't count"),
  broke: () => t("Something went wrong at the table"),
};

/** At the end of a ranked game: the result to sign, then whether it counts. */
export function RankedSign() {
  const game = useStore((s) => s.game);
  const self = useStore((s) => s.session?.selfId);
  const ranked: RankedState | undefined = game.ranked;
  const result = ranked?.result;
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const me = self ? ranked?.keys[self] : undefined;
  useEffect(() => {
    let live = true;
    if (result) void resultWrong(useStore.getState().game).then((w) => live && setWrong(w));
    return () => {
      live = false;
    };
  }, [result]);
  if (!ranked || !rankedReady(game) || !rankedOver(game)) return null;
  const nameOf = (id: string) => game.players[id]?.name ?? "?";
  if (!result && ranked.fixing)
    return (
      <div className="panel-note ranked-sign">
        <strong>{t("Fixing the score")}</strong>{" "}
        {ranked.fixing === self
          ? t("You said the score is wrong. Fix it on the table, then write the result up again.")
          : t(
              "{name} says the score is wrong. Fix it on the table together, then write the result up again.",
              {
                name: nameOf(ranked.fixing),
              },
            )}
        {me && (
          <div className="row">
            <button
              className="primary"
              onClick={() => useStore.getState().dispatch({ type: "ranked/fixed" })}
            >
              {t("Score fixed: write it up")}
            </button>
          </div>
        )}
      </div>
    );
  if (!result)
    return <div className="panel-note ranked-sign muted">{t("Writing up the ranked result…")}</div>;
  const mySeat = me ? result.players.findIndex((p) => p.key === me) : -1;
  const declined = Object.entries(ranked.sigs).find(([, s]) => s === null);
  if (declined) {
    const [who] = declined;
    const why = ranked.whys?.[who];
    const reason = why && why !== "score" ? WHY_LINES[why]() : null;
    if (who === self)
      return (
        <div className="panel-note ranked-sign">
          <strong>{t("Not ranked")}</strong>{" "}
          {t("You didn't sign, so this game doesn't count for either of you.")}
          {reason && <p className="muted small">{t("You said: {why}", { why: reason })}</p>}
        </div>
      );
    const won = mySeat >= 0 && result.winner === mySeat;
    const [a, b] = result.players;
    return (
      <div className="panel-note ranked-sign">
        <strong>{t("Not ranked")}</strong>{" "}
        {mySeat < 0
          ? t("{name} didn't sign the result, so this game doesn't count.", { name: nameOf(who) })
          : won
            ? t(
                "You won {va}–{vb}. {name} didn't sign, so it won't move the ladder, but the win stays in your replays and campaign book.",
                {
                  va: result.players[mySeat]!.vp,
                  vb: result.players[1 - mySeat]!.vp,
                  name: nameOf(who),
                },
              )
            : t(
                "{name} didn't sign, so it won't move the ladder. The game stays in your replays and campaign book.",
                { name: nameOf(who) },
              )}
        {reason && (
          <p className="muted small">{t("{name} said: {why}", { name: nameOf(who), why: reason })}</p>
        )}
        {mySeat < 0 && (
          <p className="muted small">
            {t("{a} {va} – {vb} {b}", { a: a.name, va: a.vp, vb: b.vp, b: b.name })}
          </p>
        )}
      </div>
    );
  }
  const done = bothSigned(game);
  if (done)
    return (
      <div className="panel-note ranked-sign good">
        <strong>{t("Ranked result signed")}</strong> {scoreLine(result)}.
        {me ? (
          <RatingLine result={result} me={me} />
        ) : (
          <p className="small">{t("It counts on the {game} ladder.", { game: gameName(game) })}</p>
        )}
      </div>
    );
  const signedByMe = !!self && self in ranked.sigs;
  const lost = mySeat >= 0 && result.winner !== null && result.winner !== mySeat;
  const sign = async () => {
    setBusy(true);
    const canon = canonResult(result);
    const sig = canon ? await signAsMe(signingText(canon)) : null;
    if (sig) useStore.getState().dispatch({ type: "ranked/sign", sig });
    // Signing a loss is the generous act of ranked play: it reaches the table as a handshake (PX ranked 3).
    if (sig && lost) say({ kind: "react", emoji: "🤝" });
    setBusy(false);
  };
  const decline = async (why: DeclineWhy) => {
    setBusy(true);
    const canon = canonResult(result);
    const refusal = why !== "score" && canon ? await signAsMe(declineText(canon, why)) : null;
    useStore
      .getState()
      .dispatch({ type: "ranked/sign", sig: null, why, ...(refusal ? { decline: refusal } : {}) });
    setBusy(false);
    setAsking(false);
  };
  return (
    <div className="panel-note ranked-sign">
      <strong>{t("Sign the ranked result")}</strong> {scoreLine(result)}.
      {wrong ? <p className="warn small">{wrong}</p> : null}
      {!me ? null : signedByMe ? (
        <p className="muted small">{t("Signed. Waiting for your opponent to sign.")}</p>
      ) : asking ? (
        <div className="decline-why">
          <p className="small">{t("Why not? It goes on the result, and both of you see it.")}</p>
          <div className="row wrap">
            {(["score", "agreed", "broke"] as const)
              .filter((w) => w !== "score" || (ranked.fixes ?? 0) < MAX_FIXES)
              .map((w) => (
                <button key={w} disabled={busy} onClick={() => void decline(w)}>
                  {WHY_LINES[w]()}
                </button>
              ))}
            <button className="quiet" onClick={() => setAsking(false)}>
              {t("Back")}
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy || wrong !== ""} onClick={() => void sign()}>
            {lost ? t("Sign: good game 🤝") : t("Sign: that's right")}
          </button>
          <button disabled={busy} onClick={() => setAsking(true)}>
            {t("Don't sign")}
          </button>
        </div>
      )}
      <p className="muted small">
        {t(
          "A game counts only when both players sign. Not signing means it doesn't count for either of you, and your card shows how often you sign.",
        )}
      </p>
    </div>
  );
}
