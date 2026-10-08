import { displayName } from "../i18n/names";
import { useEffect, useMemo, useState } from "react";
import { sideName, sidePlayers, sides, type GameState, type Intent } from "../core";
import { secretsWithPrefix } from "../core/secrets";
import { pendingScores, vpByRound, type Pending } from "../missions/scoring";
import type { Mission } from "../sdk";
import { keepSecret, localSecret, useLocalSecrets } from "../secrets/local";
import { systemModule } from "../systems";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { battleOver } from "./StatsScreen";
import { t, tc, tn } from "../i18n";

/** The game's chosen mission (SystemModule.missions), if any. */
export function missionOf(game: GameState): Mission | undefined {
  return systemModule(game.system).missions?.find((m) => m.id === game.mission?.id);
}

/** Logs a side's score (or that it passed, with no vp), noting the suggestion when the player changed it. */
function confirmScore(dispatch: (intent: Intent, as?: string) => void, p: Pending, by: string, vp?: number) {
  dispatch(
    {
      type: "score/confirm",
      key: p.key,
      seat: p.seat,
      round: p.round,
      vp: vp ?? 0,
      why: `${p.rule}: ${p.why}`,
      ...(vp === undefined ? { skipped: true } : vp !== p.vp ? { suggested: p.vp } : {}),
    },
    by,
  );
}

/** Before the battle: pick a mission, which sets the deployment zones and objectives. */
export function MissionPicker() {
  const game = useGame();
  const { dispatch } = useStore();
  const missions = systemModule(game.system).missions ?? [];
  if (!missions.length || game.turn.round > 0) return null;
  const chosen = missionOf(game);
  const pick = (id: string) => {
    const m = missions.find((x) => x.id === id);
    if (!m) return;
    const { zones, objectives } = m.setup(game.table);
    dispatch({ type: "mission/set", mission: { id: m.id, name: m.name }, zones, objectives });
  };
  return (
    <div className="mission-picker">
      <label>
        {t("Mission")}{" "}
        <select value={chosen?.id ?? ""} onChange={(e) => pick(e.target.value)}>
          <option value="">{t("None (score by hand)")}</option>
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {chosen && <p className="muted small">{chosen.summary}</p>}
    </div>
  );
}

/**
 * Scores waiting on a player: at each scoring moment the app suggests a side's
 * VP from the mission, and a player of that side confirms it (or changes it,
 * or passes). Nothing is added to the score until someone does.
 */
export function ScorePanel({ inline }: { inline?: boolean }) {
  const game = useGame();
  const record = useStore((s) => s.record);
  const { dispatch, scrub, role, stats } = useStore();
  const canControl = useCanControl();
  const mission = missionOf(game);
  const pending = useMemo(() => pendingScores(record, game, mission), [record, game, mission]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  if (!pending.length || scrub !== null) return null;
  // Once the battle is over the result screen lists them (inline), not the floating panel.
  if (!inline && (stats ?? battleOver(game))) return null;
  return (
    <div className={inline ? "score-inline" : "panel score-panel"} role="status">
      <strong>{inline ? t("Scores to confirm") : tc("noun", "Score")}</strong>
      {pending.map((p) => {
        const mine =
          role !== "spectator" ? sidePlayers(game, p.seat).find((x) => canControl(x.id)) : undefined;
        const vp = edits[p.key] ?? p.vp;
        const confirm = (skipped?: boolean) => confirmScore(dispatch, p, mine!.id, skipped ? undefined : vp);
        return (
          <div key={p.key} className="score-item">
            <span>
              {t("Round {n}", { n: p.round })} · <strong>{sideName(game, p.seat)}</strong> · {p.rule}: {p.why}
            </span>
            {mine ? (
              <div className="row">
                <input
                  type="number"
                  aria-label={t("VP for {rule}", { rule: p.rule })}
                  value={vp}
                  onChange={(e) => setEdits({ ...edits, [p.key]: Number(e.target.value) })}
                />
                <span className="muted">{t("VP")}</span>
                <button className="primary" onClick={() => confirm()}>
                  {t("Score it")}
                </button>
                <button onClick={() => confirm(true)}>{t("Pass")}</button>
              </div>
            ) : (
              <span className="muted small">
                {t("Suggested {vp} VP · waiting for {side} to confirm", {
                  vp: p.vp,
                  side: sideName(game, p.seat),
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Secret mission cards (Mission.deck): each player draws on their own device,
 * which commits to the card (core/secrets.ts), and reveals one to score it.
 */
export function SecretMissions({ players }: { players: { id: string; name: string; color: string }[] }) {
  const game = useGame();
  const { dispatch } = useStore();
  useLocalSecrets((s) => s.kept);
  const mission = missionOf(game);
  const live = useStore((s) => s.scrub === null);
  const over = battleOver(game);
  const record = useStore((s) => s.record);
  const pending = useMemo(() => pendingScores(record, game, mission), [record, game, mission]);
  // Once the battle is over, cards still face down are turned up, unscored (missions/scoring.ts).
  const unplayed = over
    ? players.flatMap((p) =>
        secretsWithPrefix(game, p.id, "mission:")
          .filter(([, e]) => !e.revealed && localSecret(e.commitment))
          .map(([key, e]) => ({ player: p.id, key, kept: localSecret(e.commitment)! })),
      )
    : [];
  const turnUp = unplayed.map((u) => u.key).join();
  useEffect(() => {
    if (!live || !turnUp) return;
    for (const u of unplayed)
      dispatch(
        {
          type: "secret/reveal",
          player: u.player,
          key: u.key,
          value: u.kept.value,
          salt: u.kept.salt,
          label: "an unplayed secret mission card",
        },
        u.player,
      );
  }, [turnUp, live]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mission?.deck?.length || game.turn.round === 0) return null;
  const deck = mission.deck;
  const pendingCard = (k: string) => pending.find((x) => x.key === k);
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  return (
    <details className="fold secret-objectives" open>
      <summary>{t("Secret missions")}</summary>
      {seated.map((p) => {
        const cards = secretsWithPrefix(game, p.id, "mission:");
        const mine = players.some((m) => m.id === p.id);
        const held = cards.filter(([, e]) => !e.revealed);
        const draw = () => {
          // Drawn here, at random, from the cards this player doesn't hold; only the commitment goes out.
          const have = new Set(
            cards.map(([, e]) => String(localSecret(e.commitment)?.value ?? e.revealed?.value)),
          );
          const left = deck.filter((c) => !have.has(c.id));
          const card = left[crypto.getRandomValues(new Uint32Array(1))[0]! % left.length]!;
          const key = `mission:${String(cards.length).padStart(3, "0")}`;
          dispatch(
            {
              type: "secret/commit",
              player: p.id,
              secrets: [{ key, commitment: keepSecret(card.id) }],
              label: "a secret mission card",
            },
            p.id,
          );
        };
        return (
          <div key={p.id} className="stack-player">
            <span style={{ color: p.color }}>{displayName(p.name)}</span>{" "}
            {!mine && (
              <span className="muted small">{tn(held.length, "{n} face down", "{n} face down")}</span>
            )}
            <ul className="objective-list">
              {cards.map(([key, e]) => {
                const id = e.revealed
                  ? String(e.revealed.value)
                  : mine
                    ? localSecret(e.commitment)?.value
                    : undefined;
                const card = deck.find((c) => c.id === id);
                if (!e.revealed && !mine) return null;
                // Revealed during play and not yet confirmed: still to score, even after the battle (the result lists it too).
                const open = e.revealed ? pendingCard(`card:${p.id}:${key}`) : undefined;
                const due = mine ? open : undefined;
                const scored = game.scores?.find((x) => x.key === `card:${p.id}:${key}`);
                return (
                  <li key={key}>
                    {card ? (
                      <>
                        <strong>{card.name}</strong> <span className="muted small">{card.text}</span>
                      </>
                    ) : (
                      <span className="muted">{t("(drawn on another device)")}</span>
                    )}
                    {due ? (
                      <span className="row">
                        <span className="muted small">{due.why}</span>
                        <button className="primary" onClick={() => confirmScore(dispatch, due, p.id, due.vp)}>
                          {t("Score {n} VP", { n: due.vp })}
                        </button>
                        <button onClick={() => confirmScore(dispatch, due, p.id)}>{t("Pass")}</button>
                      </span>
                    ) : (
                      e.revealed && (
                        <span className="muted small">
                          {" · "}
                          {scored
                            ? scored.skipped
                              ? t("passed")
                              : t("scored {n} VP", { n: scored.vp })
                            : open || !over
                              ? t("revealed, waiting for {player} to score it", { player: p.name })
                              : t("not scored")}
                        </span>
                      )
                    )}
                    {mine && !e.revealed && card && !over && (
                      <button
                        onClick={() => {
                          const k = localSecret(e.commitment)!;
                          dispatch(
                            {
                              type: "secret/reveal",
                              player: p.id,
                              key,
                              value: k.value,
                              salt: k.salt,
                              label: "a secret mission card",
                            },
                            p.id,
                          );
                        }}
                      >
                        {t("Reveal to score")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {mine && !over && held.length < (mission.hand ?? 1) && cards.length < deck.length && (
              <button onClick={draw}>{t("Draw a card")}</button>
            )}
          </div>
        );
      })}
    </details>
  );
}

/**
 * The result: who won on VP, and each side's VP by round from the confirmed
 * scores. Shown once the battle is over; during play only the score bar's VP
 * show, and nothing projects a final result.
 */
export function Result() {
  const game = useGame();
  const record = useStore((s) => s.record);
  const mission = missionOf(game);
  const pending = useMemo(() => pendingScores(record, game, mission), [record, game, mission]);
  if (!battleOver(game)) return null;
  const seats = sides(game);
  const vp = (seat: number) => game.resources[sidePlayers(game, seat)[0]?.id ?? ""]?.VP ?? 0;
  const { rounds, bySeat } = vpByRound(game);
  const best = Math.max(...seats.map(vp));
  const winners = seats.filter((s) => vp(s) === best);
  return (
    <section className="result">
      <h4>
        {t("Result")}
        {game.mission ? ` · ${game.mission.name}` : ""}
      </h4>
      {pending.length ? (
        <ScorePanel inline />
      ) : (
        <p className="result-line">
          {winners.length === 1 ? (
            <strong>{t("{side} wins", { side: sideName(game, winners[0]!) })}</strong>
          ) : (
            <strong>{t("A draw")}</strong>
          )}{" "}
          {t("{scores} VP", { scores: seats.map((s) => vp(s)).join(" – ") })}
        </p>
      )}
      {rounds.length > 0 && (
        <table className="result-table">
          <thead>
            <tr>
              <th>{t("VP")}</th>
              {rounds.map((r) => (
                <th key={r}>{t("R{n}", { n: r })}</th>
              ))}
              <th>{t("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((seat) => (
              <tr key={seat}>
                <td>{sideName(game, seat)}</td>
                {rounds.map((r) => (
                  <td key={r}>{bySeat[seat]?.[r] ?? 0}</td>
                ))}
                <td>
                  <strong>{vp(seat)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
