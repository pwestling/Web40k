import { useMemo, useState } from "react";
import { sideName, sidePlayers, sides, type GameState } from "../core";
import { secretsWithPrefix } from "../core/secrets";
import { pendingScores, vpByRound } from "../missions/scoring";
import type { Mission } from "../sdk";
import { keepSecret, localSecret, useLocalSecrets } from "../secrets/local";
import { systemModule } from "../systems";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";
import { battleOver } from "./StatsScreen";

/** The game's chosen mission (SystemModule.missions), if any. */
export function missionOf(game: GameState): Mission | undefined {
  return systemModule(game.system).missions?.find((m) => m.id === game.mission?.id);
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
        Mission{" "}
        <select value={chosen?.id ?? ""} onChange={(e) => pick(e.target.value)}>
          <option value="">None (score by hand)</option>
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
      <strong>{inline ? "Scores to confirm" : "Score"}</strong>
      {pending.map((p) => {
        const mine =
          role !== "spectator" ? sidePlayers(game, p.seat).find((x) => canControl(x.id)) : undefined;
        const vp = edits[p.key] ?? p.vp;
        const confirm = (skipped?: boolean) =>
          dispatch(
            {
              type: "score/confirm",
              key: p.key,
              seat: p.seat,
              round: p.round,
              vp: skipped ? 0 : vp,
              why: `${p.rule}: ${vp !== p.vp ? `${p.why} (changed from ${p.vp})` : p.why}`,
              ...(skipped ? { skipped } : {}),
            },
            mine!.id,
          );
        return (
          <div key={p.key} className="score-item">
            <span>
              Round {p.round} · <strong>{sideName(game, p.seat)}</strong> · {p.rule}: {p.why}
            </span>
            {mine ? (
              <div className="row">
                <input
                  type="number"
                  aria-label={`VP for ${p.rule}`}
                  value={vp}
                  onChange={(e) => setEdits({ ...edits, [p.key]: Number(e.target.value) })}
                />
                <span className="muted">VP</span>
                <button className="primary" onClick={() => confirm()}>
                  Score it
                </button>
                <button onClick={() => confirm(true)}>Pass</button>
              </div>
            ) : (
              <span className="muted small">
                Suggested {p.vp} VP · waiting for {sideName(game, p.seat)} to confirm
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
  if (!mission?.deck?.length || game.turn.round === 0) return null;
  const deck = mission.deck;
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  return (
    <details className="fold secret-objectives" open>
      <summary>Secret missions</summary>
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
            <span style={{ color: p.color }}>{p.name}</span>{" "}
            {!mine && <span className="muted small">{held.length} face down</span>}
            <ul className="objective-list">
              {cards.map(([key, e]) => {
                const id = e.revealed
                  ? String(e.revealed.value)
                  : mine
                    ? localSecret(e.commitment)?.value
                    : undefined;
                const card = deck.find((c) => c.id === id);
                if (!e.revealed && !mine) return null;
                return (
                  <li key={key}>
                    {card ? (
                      <>
                        <strong>{card.name}</strong> <span className="muted small">{card.text}</span>
                      </>
                    ) : (
                      <span className="muted">(drawn on another device)</span>
                    )}
                    {e.revealed && <span className="muted small"> · revealed</span>}
                    {mine && !e.revealed && card && (
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
                        Reveal to score
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {mine && held.length < (mission.hand ?? 1) && cards.length < deck.length && (
              <button onClick={draw}>Draw a card</button>
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
      <h4>Result{game.mission ? ` · ${game.mission.name}` : ""}</h4>
      {pending.length ? (
        <ScorePanel inline />
      ) : (
        <p className="result-line">
          {winners.length === 1 ? (
            <strong>{sideName(game, winners[0]!)} wins</strong>
          ) : (
            <strong>A draw</strong>
          )}{" "}
          {seats.map((s) => vp(s)).join(" – ")} VP
        </p>
      )}
      {rounds.length > 0 && (
        <table className="result-table">
          <thead>
            <tr>
              <th>VP</th>
              {rounds.map((r) => (
                <th key={r}>R{r}</th>
              ))}
              <th>Total</th>
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
