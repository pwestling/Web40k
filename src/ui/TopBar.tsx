import { ClockBar, SideClock } from "./Clocks";
import { useVoice } from "../voice/voice";
import { useHelp } from "./help";
import { seatShape } from "./sides";
import { WarningsButton } from "./TableWarnings";
import { DicePicker } from "./DicePicker";
import { systemModule } from "../systems";
import { useSound } from "./sound";
import { useEffect, useRef, useState } from "react";
import { sideName, sidePlayers, sides, systemOf, turnView } from "../core";
import { actingUnits } from "../core/content/play";
import { poolUsed } from "../core/content/player";
import { formatList, t } from "../i18n";
import { useCanControl, useJoining, useStore } from "../store";
import { useGame } from "./hooks";
import { NetBanner } from "./NetBanner";

/** Round, phase and whose turn it is, plus each player's counters (CP, VP) and dice pools. */
export function TopBar() {
  const game = useGame();
  // Panels below the bar sit under its real bottom edge, however it wraps (--below-bar in styles.css).
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement.style;
    const place = () =>
      root.setProperty("--below-bar", `${Math.round(el.getBoundingClientRect().bottom + 8)}px`);
    const watch = new ResizeObserver(place);
    watch.observe(el);
    place();
    return () => {
      watch.disconnect();
      root.removeProperty("--below-bar");
    };
  }, []);
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
  // Voice at the table: a ring on whoever is talking.
  const speaking = useVoice((s) => s.speaking);
  // Whoever presses Start is ready by doing so; only the others are named.
  const notReady =
    deploying && mode !== "hotseat"
      ? players.filter((p) => !p.ready && !canControl(p.id)).map((p) => p.name)
      : [];
  // The system's own reasons to think twice before moving on (Conquest: reinforcements not in).
  const leaving = deploying ? [] : (systemModule(game.system).leaving?.(game) ?? []);
  // A side with no army yet is worth a second thought before the battle starts (UX 155).
  const armyless = deploying
    ? seats
        .filter(
          (seat) =>
            !sidePlayers(game, seat).some((p) => Object.values(game.units).some((u) => u.owner === p.id)),
        )
        .map((seat) => sideName(game, seat))
    : [];
  const warning = armyless.length
    ? armyless.length > 1
      ? t("{names} have no army yet", { names: formatList(armyless) })
      : t("{name} has no army yet", { name: armyless[0] })
    : notReady.length
      ? notReady.length > 2
        ? t("{n} players aren't ready yet", { n: notReady.length })
        : notReady.length > 1
          ? t("{names} aren't ready yet", { names: formatList(notReady) })
          : t("{name} isn't ready yet", { name: notReady[0] })
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
    const side = activeSide.length ? sideName(game, game.turn.activeSeat) : null;
    const question =
      type === "turn/next"
        ? side
          ? t("Advance a phase during {side}'s turn?", { side })
          : t("Advance a phase during the other player's turn?")
        : side
          ? t("Go back a phase during {side}'s turn?", { side })
          : t("Go back a phase during the other player's turn?");
    if (confirm(question)) dispatch({ type });
  };

  return (
    <div className="topbar" ref={bar}>
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
            <span className="side-shape" style={{ color: lead.color }} aria-hidden="true">
              {seatShape(seat)}
            </span>
            {team.map((p, i) => (
              <strong
                key={p.id}
                className={speaking[p.id] ? "speaking" : undefined}
                style={{ color: p.color }}
              >
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
            <SideClock seat={seat} />
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
          <button title={t("Previous phase")} onClick={() => dispatch({ type: "turn/prev" })}>
            ◀
          </button>
        )}
        <div className="phase">
          {deploying ? (
            <>
              <strong>{t("Deployment")}</strong>
              <span className="muted">
                {live && seats.length === 2 ? (
                  <>
                    {t("First turn:")}{" "}
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
                  t("Place your units in your zone")
                ) : joining ? (
                  t("Joining the game…")
                ) : (
                  t("Players are deploying")
                )}
              </span>
            </>
          ) : (
            <>
              <strong>
                {over
                  ? t("Battle over")
                  : rounds
                    ? t("Round {round} of {rounds} · {side}", {
                        round: game.turn.round,
                        rounds,
                        side: activeSide.length ? sideName(game, game.turn.activeSeat) : "?",
                      })
                    : t("Round {round} · {side}", {
                        round: game.turn.round,
                        side: activeSide.length ? sideName(game, game.turn.activeSeat) : "?",
                      })}
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
              title={t("End this activation; the other player goes next")}
              onClick={() => {
                setDraft(null);
                dispatch({ type: "turn/endActivation" });
              }}
            >
              {t("End activation")}
            </button>
          ) : (
            <button
              className="primary"
              title={
                (game.turn.passes ?? 0) > 0
                  ? t("Both passed: the round moves on")
                  : t("Pass; the other player goes next")
              }
              onClick={() => dispatch({ type: "turn/pass" })}
            >
              {t("Pass")}
            </button>
          ))}
        {myTurn && !over && !(view.alternating && !deploying) && (
          <button
            className={view.alternating && !deploying ? "" : notReady.length ? "" : "primary"}
            title={
              notReady.length
                ? t("Waiting for {names} to be ready", { names: formatList(notReady) })
                : t("Next phase")
            }
            onClick={() => {
              // Advisory: a player who isn't ready yet, or a step left undone, gets a say, but can be overruled.
              if (warning && !asking) setAsking(true);
              else {
                setAsking(false);
                dispatch({ type: "turn/next" });
              }
            }}
          >
            {deploying ? t("Start battle ▶") : "▶"}
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
              {deploying ? t("Start anyway") : t("Go on anyway")}
            </button>
            <button className="quiet" title={t("Not yet")} onClick={() => setAsking(false)}>
              ✕
            </button>
          </span>
        )}
        {live && (!myTurn || (view.alternating && !deploying && !over)) && (
          <span className="overflow">
            <button className="quiet" title={t("Phase options")} onClick={() => setMenu(!menu)}>
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
                    {t("Skip to the next phase")}
                  </button>
                </span>
              ) : (
                <span className="menu">
                  <button onClick={() => step("turn/next")}>{t("Advance their phase")}</button>
                  <button onClick={() => step("turn/prev")}>{t("Back a phase")}</button>
                </span>
              ))}
          </span>
        )}
      </div>
      <WarningsButton />
      <SoundToggle />
      <button
        className="quiet help-key"
        title={t("Controls (?)")}
        onClick={() => useHelp.setState({ keys: true })}
      >
        ?
      </button>
      {/* Below the phase tracker, however the bar wraps. */}
      <NetBanner />
      <ClockBar />
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
      {label} {faces.length === 0 && <span className="muted">{t("none")}</span>}
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
            title={
              rerollOnce === "rerolled" ? t("Already re-rolled this round") : t("Pick dice to re-roll first")
            }
            onClick={() => act(onReroll)}
          >
            {t("Re-roll picked (once)")}
          </button>
          <button className="primary" onClick={onReady}>
            {t("Ready")}
          </button>
        </>
      ) : (
        editable &&
        picked.length > 0 && (
          <>
            <button onClick={() => act(onSpend)}>{t("Spend")}</button>
            {!rerollOnce && <button onClick={() => act(onReroll)}>{t("Re-roll")}</button>}
          </>
        )
      )}
    </span>
  );
}

/** Sound on or off, with the table's ambience and fast dice in a small menu (PX-5c), for this device. */
function SoundToggle() {
  const { on, toggle, ambience, toggleAmbience, fast, toggleFast, volume, setVolume } = useSound();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Your dice live here too, for everyone this screen plays (UX 159).
  const mineKey = useStore((s) =>
    s.role === "spectator"
      ? ""
      : Object.values(s.game.players)
          .filter((p) => p.seat !== undefined && (s.mode === "hotseat" || p.id === s.session?.selfId))
          .map((p) => p.id)
          .join(","),
  );
  // Closes on Esc or a click anywhere else (UX 158).
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("keydown", key);
    addEventListener("pointerdown", away, { capture: true });
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("pointerdown", away, { capture: true });
    };
  }, [open]);
  return (
    <div className="sound-toggle overflow" ref={box}>
      <button
        className="quiet"
        aria-expanded={open}
        aria-label={t("Sound and dice")}
        title={on ? t("Sound and dice") : t("Sound muted")}
        onClick={() => setOpen(!open)}
      >
        {on ? "🔊" : "🔇"}
      </button>
      {open && (
        <div className="menu sound-menu" role="menu">
          <label className="check">
            <input type="checkbox" checked={on} onChange={toggle} /> {t("Sound")}
          </label>
          <label className="volume">
            {t("Volume")}{" "}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              disabled={!on}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
          <label className="check" title={t("A quiet room under the game; the turn bell follows Sound")}>
            <input type="checkbox" checked={ambience} disabled={!on} onChange={toggleAmbience} />{" "}
            {t("Table ambience")}
          </label>
          <label className="check">
            <input type="checkbox" checked={fast} onChange={toggleFast} /> {t("Fast dice")}
          </label>
          {mineKey && mineKey.split(",").map((id) => <DicePicker key={id} player={id} />)}
        </div>
      )}
    </div>
  );
}
