import { useHelp } from "./help";
import { systemModule } from "../systems";
import { useSound } from "./sound";
import { useState } from "react";
import { sideName, sidePlayers, sides, systemOf, turnView } from "../core";
import { actingUnits } from "../core/content/play";
import { poolUsed } from "../core/content/player";
import { useCanControl, useJoining, useStore } from "../store";
import { useGame } from "./hooks";
import { NetBanner } from "./NetBanner";

/** Round, phase and whose turn it is, plus each player's counters (CP, VP) and dice pools. */
export function TopBar() {
  const game = useGame();
  const { dispatch, scrub, role, setDraft } = useStore();
  const canControl = useCanControl();
  // Someone still joining watches until seated: no Start battle, no "place your units".
  const joining = useJoining();
  const live = scrub === null && role !== "spectator" && !joining;
  const players = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!);
  // A side takes its turn together (team games: several players a side, core/teams.ts).
  const activeSide = sidePlayers(game, game.turn.activeSeat);
  const seats = sides(game);
  const deploying = game.turn.round === 0;
  const mode = useStore((s) => s.mode);
  // Whoever presses Start is ready by doing so; only the others are named.
  const notReady =
    deploying && mode !== "hotseat"
      ? players.filter((p) => !p.ready && !canControl(p.id)).map((p) => p.name)
      : [];
  // The system's own reasons to think twice before moving on (Conquest: reinforcements not in).
  const leaving = deploying ? [] : (systemModule(game.system).leaving?.(game) ?? []);
  const warning = notReady.length
    ? notReady.length > 2
      ? `${notReady.length} players aren't ready yet`
      : `${notReady.join(" and ")} ${notReady.length > 1 ? "aren't" : "isn't"} ready yet`
    : leaving.join(" · ");
  const [asking, setAsking] = useState(false);
  // Only the player whose turn it is gets the phase buttons; the other can still
  // step the phase (rules are advisory) from a quiet menu, after a confirm.
  const myTurn = live && (deploying || (activeSide.length ? activeSide.some((p) => canControl(p.id)) : true));
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
    const whose = activeSide.length ? sideName(game, game.turn.activeSeat) : "the other player";
    if (confirm(`${what} a phase during ${whose}'s turn?`)) dispatch({ type });
  };

  return (
    <div className="topbar">
      {seats.map((seat) => {
        // One chip a side: its players' names, and the side's counters (shared in a team game).
        const team = sidePlayers(game, seat);
        const lead = team[0]!;
        const mine = team.find((p) => canControl(p.id));
        return (
          <div
            key={seat}
            className={`player ${seat === game.turn.activeSeat && !deploying ? "active" : ""}`}
            style={{ borderColor: lead.color }}
          >
            {team.map((p, i) => (
              <strong key={p.id} style={{ color: p.color }}>
                {i > 0 && <span className="muted"> & </span>}
                {p.name}
              </strong>
            ))}
            {counters.map(({ id: r }) => (
              <span key={r} className="counter">
                {r} {game.resources[lead.id]?.[r] ?? 0}
                {live && mine && (
                  <>
                    <button
                      onClick={() =>
                        dispatch(
                          { type: "resource/adjust", player: mine.id, resource: r, delta: -1 },
                          mine.id,
                        )
                      }
                    >
                      −
                    </button>
                    <button
                      onClick={() =>
                        dispatch({ type: "resource/adjust", player: mine.id, resource: r, delta: 1 }, mine.id)
                      }
                    >
                      +
                    </button>
                  </>
                )}
              </span>
            ))}
            {team.flatMap((p) =>
              pools.map((pool) => (
                <DicePool
                  key={`${p.id}-${pool.id}`}
                  label={team.length > 1 ? `${p.name} ${pool.name}` : pool.name}
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
              )),
            )}
          </div>
        );
      })}
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
                {live && seats.length === 2 ? (
                  <>
                    First turn:{" "}
                    <select
                      value={game.turn.firstSeat}
                      onChange={(e) => dispatch({ type: "turn/first", seat: Number(e.target.value) })}
                    >
                      {seats.map((seat) => (
                        <option key={seat} value={seat}>
                          {sideName(game, seat)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : live ? (
                  "Place your units in your zone"
                ) : joining ? (
                  "Joining the game…"
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
                  : `Round ${game.turn.round}${rounds ? ` of ${rounds}` : ""} · ${activeSide.length ? sideName(game, game.turn.activeSeat) : "?"}`}
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
              onClick={() => {
                setDraft(null);
                dispatch({ type: "turn/endActivation" });
              }}
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
            className={view.alternating && !deploying ? "" : notReady.length ? "" : "primary"}
            title={notReady.length ? `Waiting for ${notReady.join(" and ")} to be ready` : "Next phase"}
            onClick={() => {
              // Advisory: a player who isn't ready yet, or a step left undone, gets a say, but can be overruled.
              if (warning && !asking) setAsking(true);
              else {
                setAsking(false);
                dispatch({ type: "turn/next" });
              }
            }}
          >
            {deploying ? "Start battle ▶" : "▶"}
          </button>
        )}
        {asking && warning && (
          <span className="ask">
            {warning} ·{" "}
            <button
              className="primary"
              onClick={() => {
                setAsking(false);
                dispatch({ type: "turn/next" });
              }}
            >
              {deploying ? "Start anyway" : "Go on anyway"}
            </button>
            <button className="quiet" title="Not yet" onClick={() => setAsking(false)}>
              ✕
            </button>
          </span>
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
      <SoundToggle />
      <button
        className="quiet help-key"
        title="Controls (?)"
        onClick={() => useHelp.setState({ keys: true })}
      >
        ?
      </button>
      {/* Below the phase tracker, however the bar wraps. */}
      <NetBanner />
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

/** Sound on or off, with the table's ambience and fast dice in a small menu (PX-5c), for this device. */
function SoundToggle() {
  const { on, toggle, ambience, toggleAmbience, fast, toggleFast } = useSound();
  const [open, setOpen] = useState(false);
  return (
    <div className="sound-toggle overflow">
      <button
        className="quiet"
        aria-expanded={open}
        aria-label="Sound"
        title={on ? "Sound on" : "Sound muted"}
        onClick={() => setOpen(!open)}
      >
        {on ? "🔊" : "🔇"}
      </button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <label className="check">
            <input type="checkbox" checked={on} onChange={toggle} /> Sound
          </label>
          <label className="check" title="A quiet room under the game; the turn bell follows Sound">
            <input type="checkbox" checked={ambience} disabled={!on} onChange={toggleAmbience} /> Table
            ambience
          </label>
          <label className="check">
            <input type="checkbox" checked={fast} onChange={toggleFast} /> Fast dice
          </label>
        </div>
      )}
    </div>
  );
}
