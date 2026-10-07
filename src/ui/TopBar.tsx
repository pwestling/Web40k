import { useState } from "react";
import { systemOf, turnView } from "../core";
import { actingUnits } from "../core/content/play";
import { poolUsed } from "../core/content/player";
import { useCanControl, useStore } from "../store";
import { useGame } from "./hooks";

/** Round, phase and whose turn it is, plus each player's counters (CP, VP) and dice pools. */
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
  // Only the player whose turn it is gets the phase buttons; the other can still
  // step the phase (rules are advisory) from a quiet menu, after a confirm.
  const myTurn = live && (deploying || (active ? canControl(active.id) : true));
  const [menu, setMenu] = useState(false);
  const system = systemOf(game);
  const counters = (system.resources ?? []).filter((r) => r.kind !== "dicePool");
  const pools = (system.resources ?? []).filter((r) => r.kind === "dicePool");
  const view = turnView(game);
  const rounds = typeof system.turn.rounds === "number" ? system.turn.rounds : null;
  const over = rounds !== null && game.turn.round > rounds;
  const step = (type: "turn/next" | "turn/prev") => {
    setMenu(false);
    const what = type === "turn/next" ? "Advance" : "Go back";
    if (confirm(`${what} a phase during ${active?.name ?? "the other player"}'s turn?`)) dispatch({ type });
  };

  return (
    <div className="topbar">
      {players.map((p) => (
        <div
          key={p.id}
          className={`player ${p.seat === game.turn.activeSeat && !deploying ? "active" : ""}`}
          style={{ borderColor: p.color }}
        >
          <strong style={{ color: p.color }}>{p.name}</strong>
          {counters.map(({ id: r }) => (
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
          {pools.map((pool) => (
            <DicePool
              key={pool.id}
              label={pool.name}
              faces={game.pools?.[p.id]?.[pool.id] ?? []}
              editable={live && canControl(p.id)}
              rerollOnce={pool.rerollOnce ? (poolUsed(game, p.id, pool.id) ?? "open") : undefined}
              onReady={() => dispatch({ type: "pool/ready", player: p.id, resource: pool.id }, p.id)}
              onSpend={(indices) =>
                dispatch({ type: "pool/spend", player: p.id, resource: pool.id, indices }, p.id)
              }
              onReroll={(indices) =>
                dispatch({ type: "pool/reroll", player: p.id, resource: pool.id, indices }, p.id)
              }
            />
          ))}
        </div>
      ))}
      <div className="turn">
        {myTurn && (
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
                ) : live ? (
                  "Place your units in your zone"
                ) : (
                  "Players are deploying"
                )}
              </span>
            </>
          ) : (
            <>
              <strong>
                {over
                  ? "Battle over"
                  : `Round ${game.turn.round}${rounds ? ` of ${rounds}` : ""} · ${active?.name ?? "?"}`}
              </strong>
              <span className="phases">
                {view.phases.map((ph, i) => (
                  <span key={`${ph}${i}`} className={i === view.current ? "current" : ""}>
                    {ph}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
        {myTurn &&
          view.alternating &&
          !deploying &&
          !over &&
          // One button that follows the state: end the unit's activation, or pass.
          (actingUnits(game).length ? (
            <button
              className="primary"
              title="End this activation; the other player goes next"
              onClick={() => dispatch({ type: "turn/endActivation" })}
            >
              End activation
            </button>
          ) : (
            <button
              className="primary"
              title={
                (game.turn.passes ?? 0) > 0
                  ? "Both passed: the round moves on"
                  : "Pass; the other player goes next"
              }
              onClick={() => dispatch({ type: "turn/pass" })}
            >
              Pass
            </button>
          ))}
        {myTurn && !over && !(view.alternating && !deploying) && (
          <button
            className={view.alternating && !deploying ? "" : "primary"}
            title="Next phase"
            onClick={() => dispatch({ type: "turn/next" })}
          >
            {deploying ? "Start battle ▶" : "▶"}
          </button>
        )}
        {live && (!myTurn || (view.alternating && !deploying && !over)) && (
          <span className="overflow">
            <button className="quiet" title="Phase options" onClick={() => setMenu(!menu)}>
              ⋯
            </button>
            {menu &&
              (myTurn ? (
                <span className="menu">
                  <button
                    onClick={() => {
                      setMenu(false);
                      dispatch({ type: "turn/next" });
                    }}
                  >
                    Skip to the next phase
                  </button>
                </span>
              ) : (
                <span className="menu">
                  <button onClick={() => step("turn/next")}>Advance their phase</button>
                  <button onClick={() => step("turn/prev")}>Back a phase</button>
                </span>
              ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** A player's dice pool, e.g. ready activation dice: pick dice to spend or re-roll. */
function DicePool({
  label,
  faces,
  editable,
  onSpend,
  onReroll,
  rerollOnce,
  onReady,
}: {
  label: string;
  faces: number[];
  editable: boolean;
  onSpend: (indices: number[]) => void;
  onReroll: (indices: number[]) => void;
  /** For pools re-rolled once per round: where the player is in that roll step. */
  rerollOnce?: "open" | "rerolled" | "ready";
  onReady: () => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  const act = (f: (indices: number[]) => void) => {
    f(picked);
    setPicked([]);
  };
  return (
    <span className="counter pool" title={label}>
      {label} {faces.length === 0 && <span className="muted">none</span>}
      {faces.map((f, i) => (
        <button
          key={i}
          className={`die ${picked.includes(i) ? "on" : ""}`}
          disabled={!editable}
          onClick={() => toggle(i)}
        >
          {f}
        </button>
      ))}
      {editable && faces.length > 0 && rerollOnce && rerollOnce !== "ready" ? (
        // The roll step: re-roll any dice once, then say you're ready.
        <>
          <button
            disabled={rerollOnce === "rerolled" || picked.length === 0}
            title={rerollOnce === "rerolled" ? "Already re-rolled this round" : "Pick dice to re-roll first"}
            onClick={() => act(onReroll)}
          >
            Re-roll selected (once)
          </button>
          <button className="primary" onClick={onReady}>
            Ready
          </button>
        </>
      ) : (
        editable &&
        picked.length > 0 && (
          <>
            <button onClick={() => act(onSpend)}>Spend</button>
            {!rerollOnce && <button onClick={() => act(onReroll)}>Re-roll</button>}
          </>
        )
      )}
    </span>
  );
}
