import { DiceChoice } from "../companion/RealDice";
import { RankedChip } from "../ranked/RankedGame";
import { displayName, playerName } from "../i18n/names";
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
import { formatList, t, tn, gameText } from "../i18n";
import { useWatching } from "../opentables/live";
import { useCanControl, useJoining, useStore } from "../store";
import { characterName, levelName, useSolo } from "../bot/solo";
import { useGame } from "./hooks";
import { NetBanner } from "./NetBanner";
import { useMail } from "../mail/store";

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
  // A mail game: the one who made it starts the battle, once they have the other side's file (UX 402).
  const mail = useMail((s) => s.game);
  const seatedByMail = useStore((s) => s.mail !== null);
  const mailGuest = deploying && seatedByMail && !!mail && mail.me !== "p1";
  const host = mail ? Object.entries(mail.names).find(([p]) => p !== mail.me)?.[1] || t("your opponent") : "";
  // Voice at the table: a ring on whoever is talking.
  const speaking = useVoice((s) => s.speaking);
  // Whoever presses Start is ready by doing so; only the others are named.
  const notReady =
    deploying && mode !== "hotseat"
      ? players.filter((p) => !p.ready && !canControl(p.id)).map((p) => p.name)
      : [];
  // The system's own reasons to think twice before moving on (Conquest: reinforcements not in).
  // A rule waiting on a player's answer (UX 246: a dispel question) holds the phase until it's answered.
  const asked = !deploying && game.script?.waiting;
  const askedText = asked
    ? t("Waiting for {name} to answer: {question}", {
        name: playerName(game.players[asked.player]) ?? t("a player"),
        question: asked.question,
      })
    : null;
  const leaving = deploying
    ? []
    : [...(askedText ? [askedText] : []), ...(systemModule(game.system).leaving?.(game) ?? [])];
  // A side with no army yet is worth a second thought before the battle starts (UX 155).
  const armyless = deploying
    ? seats
        .filter(
          (seat) =>
            !sidePlayers(game, seat).some((p) => Object.values(game.units).some((u) => u.owner === p.id)),
        )
        .map((seat) => sideName(game, seat))
    : [];
  // A game with missions to pick from, and none picked, ends 0-0 unless scored by hand (UX 394).
  const missionless = deploying && !game.mission && !!systemModule(game.system).missions?.length;
  const people = armyless.length
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
  const warning = [people, missionless ? t("No mission: you'll score by hand") : ""]
    .filter(Boolean)
    .join(" · ");
  const [asking, setAsking] = useState(false);
  // Only the player whose turn it is gets the phase buttons; the other can still
  // step the phase (rules are advisory) from a quiet menu, after a confirm.
  const myTurn = live && (deploying || (activeSide.length ? activeSide.some((p) => canControl(p.id)) : true));
  const [menu, setMenu] = useState(false);
  // Solo against the computer (#45): its go is its own; ⋯ can pause it (UX 347).
  const solo = useSolo((s) => (s.level && s.session === useStore.getState().session ? s : null));
  const computerGo =
    live && !!solo && !solo.paused && !deploying && activeSide.some((p) => p.seat === solo.seat);
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
                {/* An exhibition's two sides carry their own names (UX 447). */}
                {solo && !solo.both && p.seat === solo.seat ? (
                  // The computer by name, its level in small type (PX 4).
                  <>
                    {characterName(solo.level!)} <small className="muted">{levelName(solo.level!)}</small>
                  </>
                ) : (
                  displayName(p.name)
                )}
              </strong>
            ))}
            {counters.map(({ id: r }) => (
              <Counter
                key={r}
                label={r}
                value={game.resources[lead.id]?.[r] ?? 0}
                step={
                  live && mine
                    ? (delta) =>
                        dispatch({ type: "resource/adjust", player: mine.id, resource: r, delta }, mine.id)
                    : null
                }
              />
            ))}
            <SideClock seat={seat} />
            {team.flatMap((p) =>
              pools.map((pool) => (
                <DicePool
                  key={`${p.id}-${pool.id}`}
                  // The short name keeps two pools on one top bar row at 1280 wide (UX 267).
                  label={
                    team.length > 1
                      ? `${displayName(p.name)} ${pool.short ?? pool.name}`
                      : (pool.short ?? pool.name)
                  }
                  title={pool.name}
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
        {computerGo && (
          <span className="muted computer-go">
            {t("{name} is playing…", {
              name: solo!.both ? displayName(activeSide[0]?.name ?? "") : characterName(solo.level!),
            })}
          </span>
        )}
        {live && solo?.paused && (
          <button className="quiet" onClick={() => useSolo.setState({ paused: false })}>
            {t("Let the computer play")}
          </button>
        )}
        {myTurn && (
          <button title={t("Previous phase")} onClick={() => dispatch({ type: "turn/prev" })}>
            ◀
          </button>
        )}
        <WatchingChip />
        <RankedChip />
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
                    {gameText(ph)}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
        {/* Supremacy (#55): the lower roll picks who goes first, and may hand it over before anyone acts. */}
        {myTurn &&
          game.rolledOff?.chooses &&
          game.rolledOff.seat === game.turn.activeSeat &&
          !Object.values(game.units).some((u) => u.status?.activated) && (
            <button
              title={t("The roll-off lets you pick who goes first this round")}
              onClick={() => dispatch({ type: "turn/first", seat: (game.turn.activeSeat + 1) % 2 })}
            >
              {t("Let {side} go first", { side: sideName(game, (game.turn.activeSeat + 1) % 2) })}
            </button>
          )}
        {myTurn &&
          view.alternating &&
          !deploying &&
          !over &&
          // One button that follows the state: end the unit's activation, or pass.
          (actingUnits(game).length ? (
            <button
              className="primary"
              // Not mid-roll: a question still open (the saves) holds the go (UX 365, PX).
              disabled={!!asked}
              title={
                asked
                  ? t("Answer the open question first")
                  : t("End this activation; the other player goes next")
              }
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
        {mailGuest && (
          <span className="muted small">
            {mail.segment
              ? t("Deploy, then Send to {name}", { name: host })
              : t("Waiting for {name} to start", { name: host })}
          </span>
        )}
        {myTurn && !over && !mailGuest && !(view.alternating && !deploying) && (
          <button
            className={`next-phase ${view.alternating && !deploying ? "" : notReady.length || askedText ? "" : "primary"}`}
            title={
              notReady.length
                ? t("Waiting for {names} to be ready", { names: formatList(notReady) })
                : (askedText ?? t("Next phase"))
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
            {missionless && (
              <button
                onClick={() => {
                  setAsking(false);
                  const pick = document.querySelector<HTMLSelectElement>(".mission-picker select");
                  pick?.scrollIntoView({ block: "center" });
                  pick?.focus();
                }}
              >
                {t("Pick one")}
              </button>
            )}
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
                  {computerGo && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        useSolo.setState({ paused: true });
                      }}
                    >
                      {t("Pause the computer")}
                    </button>
                  )}
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
  title,
  faces,
  editable,
  onSpend,
  onReroll,
  rerollOnce,
  onReady,
}: {
  label: string;
  title?: string;
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
    <span className="counter pool" title={title ?? label}>
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
              rerollOnce === "rerolled"
                ? t("Already re-rolled this round")
                : picked.length
                  ? t("Re-roll the picked dice: once a round")
                  : t("Pick dice to re-roll first")
            }
            onClick={() => act(onReroll)}
          >
            {t("Re-roll (once)")}
          </button>
          <button
            className="primary"
            title={t("Keep these dice as they are: you give up this round's re-roll")}
            onClick={onReady}
          >
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
          {mineKey && <DiceChoice />}
          {mineKey && mineKey.split(",").map((id) => <DicePicker key={id} player={id} />)}
        </div>
      )}
    </div>
  );
}

/** "VP 3 − +". On a touch screen the − and + wait behind a tap on the number, at full finger size (UX 436). */
function Counter({
  label,
  value,
  step,
}: {
  label: string;
  value: number;
  step: ((delta: number) => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (!step) return <span className="counter">{`${label} ${value}`}</span>;
  if (coarse && !open)
    return (
      <button
        className="counter quiet"
        data-label={label}
        title={t("Change {label}", { label })}
        onClick={() => setOpen(true)}
      >
        {`${label} ${value}`}
      </button>
    );
  return (
    <span className={coarse ? "counter open" : "counter"} data-label={label}>
      {`${label} ${value}`}
      <button onClick={() => step(-1)}>−</button>
      <button onClick={() => step(1)}>+</button>
      {coarse && (
        <button className="quiet" title={t("Done")} onClick={() => setOpen(false)}>
          ✓
        </button>
      )}
    </span>
  );
}

/** "3 watching": the players see when their game has an audience (#64). */
function WatchingChip() {
  const watching = useWatching();
  const role = useStore((s) => s.role);
  if (!watching || role === "spectator") return null;
  return (
    <span className="watching-chip small" title={t("People watching this game, running a little behind it")}>
      <span aria-hidden>👁</span> {tn(watching, "{n} watching", "{n} watching")}
    </span>
  );
}
