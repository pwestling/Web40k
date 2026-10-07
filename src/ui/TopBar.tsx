import { PHASES } from "../core";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";

/** Round, phase and whose turn it is, plus each player's CP and VP. */
export function TopBar() {
  const game = useGame();
  const { dispatch, scrub, role } = useStore();
  const canControl = useCanControl();
  const live = scrub === null && role !== "spectator";
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!);
  const active = players.find((p) => p.seat === game.turn.activeSeat);
  const deploying = game.turn.round === 0;

  return (
    <div className="topbar">
      {players.map((p) => (
        <div
          key={p.id}
          className={`player ${p.seat === game.turn.activeSeat && !deploying ? "active" : ""}`}
          style={{ borderColor: p.color }}
        >
          <strong style={{ color: p.color }}>{p.name}</strong>
          {(["CP", "VP"] as const).map((r) => (
            <span key={r} className="counter">
              {r} {game.resources[p.id]?.[r] ?? 0}
              {live && canControl(p.id) && (
                <>
                  <button
                    onClick={() =>
                      dispatch({ type: "resource/adjust", player: p.id, resource: r, delta: -1 }, p.id)
                    }
                  >
                    −
                  </button>
                  <button
                    onClick={() =>
                      dispatch({ type: "resource/adjust", player: p.id, resource: r, delta: 1 }, p.id)
                    }
                  >
                    +
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      ))}
      <div className="turn">
        {live && (
          <button title="Previous phase" onClick={() => dispatch({ type: "turn/prev" })}>
            ◀
          </button>
        )}
        <div className="phase">
          {deploying ? (
            <>
              <strong>Deployment</strong>
              <span className="muted">
                {live && players.length === 2 ? (
                  <>
                    First turn:{" "}
                    <select
                      value={game.turn.firstSeat}
                      onChange={(e) => dispatch({ type: "turn/first", seat: Number(e.target.value) })}
                    >
                      {players.map((p) => (
                        <option key={p.id} value={p.seat}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  "Place your units in your zone"
                )}
              </span>
            </>
          ) : (
            <>
              <strong>
                Round {game.turn.round} · {active?.name ?? "?"}
              </strong>
              <span className="phases">
                {PHASES.map((ph, i) => (
                  <span key={ph} className={i === game.turn.phase ? "current" : ""}>
                    {ph}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
        {live && (
          <button className="primary" title="Next phase" onClick={() => dispatch({ type: "turn/next" })}>
            {deploying ? "Start battle ▶" : "▶"}
          </button>
        )}
      </div>
    </div>
  );
}
