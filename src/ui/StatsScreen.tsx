import { useEffect, useMemo } from "react";
import { branchGame } from "./Branch";
import { systemOf, type GameState } from "../core";
import { momentsOf } from "../core/moments";
import { playMoment, useReel } from "../broadcast/Moments";
import { gameStats, type PlayerStats, type StepLuck } from "../core/stats";
import { useStore } from "../store";
import { useGame } from "./hooks";

/** The battle has run past its last round. */
export function battleOver(game: GameState): boolean {
  try {
    const rounds = systemOf(game).turn.rounds;
    return typeof rounds === "number" && game.turn.round > rounds;
  } catch {
    return false;
  }
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
const stepName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, " ");

/**
 * After the game (or any time from a replay): damage per unit, points
 * destroyed per round, and how each player's dice ran against the odds.
 * Built from the event log, so every game system gets it.
 */
export function StatsScreen() {
  const record = useStore((s) => s.record);
  const stats = useStore((s) => s.stats);
  const set = useStore((s) => s.set);
  const game = useGame();
  // Opens on its own once the battle ends, until someone closes it.
  const open = stats ?? battleOver(game);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.getState().set({ stats: false });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);
  const data = useMemo(() => (open ? gameStats(record) : null), [open, record]);
  const moments = useMemo(() => (open ? momentsOf(record) : []), [open, record]);
  // The end-of-game reel plays first.
  const reeling = useReel((s) => s.index !== null);
  if (!open || !data || reeling) return null;
  const close = () => set({ stats: false });
  const owners = new Map(data.players.map((p) => [p.id, p]));
  const units = [...data.units].sort((a, b) => b.dealt - a.dealt || b.taken - a.taken);

  return (
    <div className="stats-screen" role="dialog" aria-label="Battle stats">
      <div className="head">
        <strong>Battle stats</strong>
        <span className="muted">
          {data.rounds} round{data.rounds === 1 ? "" : "s"}
        </span>
        <button className="quiet" title="Close" onClick={close}>
          ✕
        </button>
      </div>

      <section>
        <h4>Points destroyed per round</h4>
        <PointsChart players={data.players} rounds={data.rounds} />
      </section>

      <section>
        <h4>Dice against the odds</h4>
        <div className="luck">
          {data.players.map((p) => (
            <LuckTable key={p.id} player={p} />
          ))}
        </div>
      </section>

      {moments.length > 0 && (
        <section>
          <h4>Moments</h4>
          <ul className="moments">
            {moments.map((m) => (
              <li key={`${m.kind}-${m.seq}-${m.player ?? ""}`}>
                {m.kind === "rare" && <span className="rare-star">★</span>} {m.when} ·{" "}
                <button
                  className="link"
                  title="Watch it again on the table"
                  onClick={() => {
                    close();
                    playMoment(m);
                  }}
                >
                  <strong>{m.title}</strong>
                </button>
                : {m.line}{" "}
                {m.kind !== "mvp" && (
                  <button
                    className="quiet small"
                    title="A new game on this screen, just before this moment"
                    onClick={() => branchGame(m.seq - 1, "hotseat")}
                  >
                    Practice from here
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>Units</h4>
        {units.length ? (
          <table className="stats-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th title="Wounds this unit's attacks took off enemy models">Dealt</th>
                <th title="Enemy models this unit's attacks destroyed">Slain</th>
                <th title="Wounds this unit lost, from any cause">Taken</th>
                <th title="Models this unit lost, from any cause">Lost</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="swatch" style={{ background: owners.get(u.owner)?.color }} />
                    {u.name}
                  </td>
                  <td>{u.dealt}</td>
                  <td>{u.slain}</td>
                  <td>{u.taken}</td>
                  <td>{u.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No damage dealt yet.</p>
        )}
      </section>
    </div>
  );
}

function LuckTable({ player }: { player: PlayerStats }) {
  const total = player.luck.reduce((a, l) => a + l.actual - l.expected, 0);
  // A net of zero can hide good hits and bad wounds cancelling out.
  const spread = player.luck.some((l) => Math.abs(l.actual - l.expected) >= 0.5);
  return (
    <div>
      <div className="who">
        <span className="swatch" style={{ background: player.color }} />
        <strong>{player.name}</strong>
        {player.luck.length > 0 && (
          <span className="muted">
            {" "}
            {Math.abs(total) < 0.05
              ? spread
                ? "even overall (luck in one roll, not another)"
                : "right on the odds"
              : `${Math.abs(total).toFixed(1)} dice ${total > 0 ? "luckier" : "unluckier"} than the odds`}
          </span>
        )}
      </div>
      {player.luck.length ? (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Roll</th>
              <th title="Dice rolled">Dice</th>
              <th title="Dice that passed (hits, wounds, saves made)">Passed</th>
              <th>Expected</th>
              <th title="Dice that passed minus dice expected to">±</th>
            </tr>
          </thead>
          <tbody>
            {player.luck.map((l: StepLuck) => (
              <tr key={l.step}>
                <td>{stepName(l.step)}</td>
                <td>{l.rolled}</td>
                <td>{l.actual}</td>
                <td>{l.expected.toFixed(1)}</td>
                <td className={l.actual - l.expected >= 0 ? "up" : "down"}>
                  {signed(l.actual - l.expected)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No rolls yet.</p>
      )}
    </div>
  );
}

/** Grouped bars: one group per round, one bar per player, in seat order. */
function PointsChart({ players, rounds }: { players: PlayerStats[]; rounds: number }) {
  const W = 420;
  const H = 150;
  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const max = Math.max(1, ...players.flatMap((p) => p.pointsByRound));
  const group = (W - pad.l - pad.r) / Math.max(1, rounds);
  const bar = Math.min(28, (group - 16) / Math.max(1, players.length) - 2);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  // A bar rounded at its data end (the top), square on the baseline.
  const path = (x: number, v: number) => {
    const top = y(v);
    const r = Math.min(4, bar / 2, H - pad.b - top);
    return `M${x},${H - pad.b}V${top + r}Q${x},${top} ${x + r},${top}H${x + bar - r}Q${x + bar},${top} ${x + bar},${top + r}V${H - pad.b}Z`;
  };
  return (
    <>
      <div className="legend-row">
        {players.map((p) => (
          <span key={p.id}>
            <span className="swatch" style={{ background: p.color }} />
            {p.name} · {Math.round(p.pointsByRound.reduce((a, b) => a + b, 0))} pts
          </span>
        ))}
      </div>
      <svg
        className="points-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Points destroyed per round"
      >
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        {Array.from({ length: rounds }, (_, i) => {
          const x0 = pad.l + i * group + (group - players.length * (bar + 2)) / 2;
          return (
            <g key={i}>
              {players.map((p, j) => {
                const v = p.pointsByRound[i] ?? 0;
                const x = x0 + j * (bar + 2);
                return (
                  <g key={p.id}>
                    {/* A wider invisible target so a 0 bar still shows its tooltip. */}
                    <rect x={x} y={pad.t} width={bar} height={H - pad.t - pad.b} fill="transparent">
                      <title>{`${p.name}, round ${i + 1}: ${Math.round(v)} pts`}</title>
                    </rect>
                    {v > 0 && (
                      <>
                        <path d={path(x, v)} fill={p.color} pointerEvents="none" />
                        <text x={x + bar / 2} y={y(v) - 4} className="value">
                          {Math.round(v)}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
              <text x={pad.l + i * group + group / 2} y={H - 6} className="tick">
                Round {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
