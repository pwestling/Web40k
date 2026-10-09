import { becauseText, damageValue, stepValue } from "./autoText";
import { RollsMineToggle, SelfRollCountdown } from "../bot/SelfRoll";
import { touch } from "./touch";
import { playerName } from "../i18n/names";
import { useCoach, computerPlays } from "../teach/store";
import { focusSoon } from "./focusSoon";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { passes, type AttackSpec, type AttackState, type Die, type GameState, type Reroll } from "../core";
import {
  aliveModels,
  carriers,
  mainWeapon,
  suggestAttack,
  unitDistance,
  weaponReach,
  type AttackSuggestion,
} from "../systems/wh40k/rules";
import { attackReminders } from "../core/content/player";
import { commonLoadout, loadoutKey } from "../core/content/runtime";
import { useCanControl, useStore, type AttackDraft } from "../store";
import { Reminders } from "./PlayPanel";
import { useGame } from "./hooks";
import { ActionSetup, ProcedurePanel } from "./ProcedurePanels";
import { opposed } from "../core/teams";
import { t, tn } from "../i18n";
import { RollButton, useOwnDice } from "../companion/RealDice";
import { TableAttackSetup } from "../companion/TableAttack";
import { fireNext, useVolley, volleyWeapons } from "./volley";
import { FightOrderNote } from "../systems/wh40k/FightOrderNote";

/**
 * The attack sequence. Choosing a weapon and target is local; once declared,
 * the attack lives in the shared game state and anyone can roll each stage
 * (by convention the defender rolls saves).
 */
export function AttackPanel() {
  const game = useGame();
  const { draft, scrub } = useStore();
  if (game.procedure) return <ProcedurePanel />;
  if (game.attack) return <AttackInProgress attack={game.attack} live={scrub === null} />;
  if (draft?.action && scrub === null) return <ActionSetup draft={{ ...draft, action: draft.action }} />;
  if (draft && scrub === null) return <AttackSetup draft={draft} />;
  return null;
}

function AttackSetup({ draft }: { draft: AttackDraft }) {
  const game = useGame();
  if (game.settings.companion) return <TableAttackSetup draft={draft} />;
  return <BoardAttackSetup draft={draft} />;
}

function BoardAttackSetup({ draft }: { draft: AttackDraft }) {
  const game = useGame();
  const { setDraft, dispatch } = useStore();
  const attacker = game.units[draft.attackerId];
  if (!attacker) return null;
  const weapons = Object.values(attacker.sheet?.weapons ?? {})
    .filter((w) => w.kind === draft.kind)
    .map((w) => ({ ...w, count: carriers(game, attacker, w.id).length }))
    .sort((a, b) => b.count - a.count);
  const weaponId = draft.weaponId ?? mainWeapon(game, attacker, draft.kind);
  const weapon = weapons.find((w) => w.id === weaponId);
  const reach = weapon ? weaponReach(weapon) : null;
  // Closest models carrying the weapon; enemies out of its reach go last and say so.
  const shooters = weapon ? carriers(game, attacker, weapon.id) : aliveModels(game, attacker);
  const enemies = Object.values(game.units)
    .filter((u) => opposed(game, u.owner, attacker.owner) && aliveModels(game, u).length > 0)
    .map((u) => {
      const distance = unitDistance(shooters, aliveModels(game, u));
      return { unit: u, distance, out: reach !== null && distance > reach };
    })
    .sort((a, b) => Number(a.out) - Number(b.out) || a.distance - b.distance);
  const suggestion =
    weaponId && draft.targetId && !draft.all
      ? suggestAttack(game, attacker.id, weaponId, draft.targetId)
      : null;

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {draft.all
            ? t("{unit}: shoot everything", { unit: attacker.name })
            : draft.kind === "ranged"
              ? t("{unit}: shoot", { unit: attacker.name })
              : t("{unit}: fight", { unit: attacker.name })}
        </strong>
        <button onClick={() => setDraft(null)}>{t("Cancel")}</button>
      </div>
      <div className="row wrap">
        {!draft.all && (
          <select
            aria-label={t("Weapon")}
            value={weaponId ?? ""}
            onChange={(e) => setDraft({ ...draft, weaponId: e.target.value || undefined })}
          >
            <option value="">{t("Weapon…")}</option>
            {weapons.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} (×{w.count}){attacker.status?.[`fired.${w.id}`] ? ` · ${t("used this phase")}` : ""}
              </option>
            ))}
          </select>
        )}
        <span>{t("at")}</span>
        <select
          className="attack-target"
          aria-label={t("Target")}
          value={draft.targetId ?? ""}
          onChange={(e) => setDraft({ ...draft, targetId: e.target.value || undefined, picking: false })}
        >
          <option value="">{t("Target…")}</option>
          {enemies.map(({ unit: u, distance, out }) => (
            <option key={u.id} value={u.id}>
              {out
                ? t('{unit} ({distance}", out of range)', { unit: u.name, distance: distance.toFixed(1) })
                : `${u.name} (${distance.toFixed(1)}")`}
            </option>
          ))}
        </select>
        <button
          className={draft.picking ? "on" : ""}
          onClick={() => setDraft({ ...draft, picking: !draft.picking })}
        >
          {draft.picking
            ? touch()
              ? t("Tap a target on the table…")
              : t("Click a target on the table…")
            : t("Pick on table")}
        </button>
      </div>
      {draft.all && draft.targetId && (
        <VolleyPick key={draft.targetId} attackerId={attacker.id} targetId={draft.targetId} />
      )}
      {draft.kind === "melee" && <FightOrderNote unitId={attacker.id} />}
      {suggestion && (
        <SpecEditor
          key={`${weaponId}|${draft.targetId}`}
          suggestion={suggestion}
          onDeclare={(spec) => {
            dispatch({ type: "attack/declare", spec }, attacker.owner);
            setDraft(null);
            focusSoon(".panel.attack .attack-roll");
          }}
        />
      )}
    </div>
  );
}

/** Every weapon that can fire at the target, ticked; untick to split fire (UX 398). */
function VolleyPick({ attackerId, targetId }: { attackerId: string; targetId: string }) {
  const game = useGame();
  const { setDraft } = useStore();
  const weapons = useMemo(() => volleyWeapons(game, attackerId, targetId), [game, attackerId, targetId]);
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const on = weapons.filter((w) => !w.why && !off.has(w.id));
  if (!weapons.some((w) => !w.why))
    return <p className="warn">{t("No weapon can reach and see that target.")}</p>;
  return (
    <div className="volley">
      {weapons.map((w) =>
        w.why ? (
          <span key={w.id} className="muted small">
            {w.name}: {w.why}
          </span>
        ) : (
          <label key={w.id} className="row">
            <input
              type="checkbox"
              checked={!off.has(w.id)}
              onChange={(e) => {
                const next = new Set(off);
                if (e.target.checked) next.delete(w.id);
                else next.add(w.id);
                setOff(next);
              }}
            />{" "}
            {w.name}{" "}
            <span className="muted small">{tn(w.inRange, "{n} model in range", "{n} models in range")}</span>
          </label>
        ),
      )}
      <button
        className="primary"
        disabled={!on.length}
        onClick={() => {
          useVolley.setState({ queue: { attackerId, targetId, weapons: on.map((w) => w.id) } });
          setDraft(null);
          fireNext();
          focusSoon(".panel.attack .attack-roll");
        }}
      >
        {tn(on.length, "Shoot {n} weapon", "Shoot {n} weapons")}
      </button>
    </div>
  );
}

export function SpecEditor({
  suggestion,
  onDeclare,
  declare,
}: {
  suggestion: AttackSuggestion;
  onDeclare: (spec: AttackSpec) => void;
  /** The declare button, when it isn't the board's (the table companion's rolls the attacks itself). */
  declare?: (spec: AttackSpec) => ReactNode;
}) {
  const [spec, setSpec] = useState(suggestion.spec);
  const game = useGame();
  const set = <K extends keyof AttackSpec>(k: K, v: AttackSpec[K]) => setSpec({ ...spec, [k]: v });
  const target = (v: number | null, onChange: (v: number | null) => void, allowNone: string) => (
    <select value={v ?? 0} onChange={(e) => onChange(Number(e.target.value) || null)}>
      <option value={0}>{allowNone}</option>
      {[2, 3, 4, 5, 6].map((n) => (
        <option key={n} value={n}>
          {n}+
        </option>
      ))}
    </select>
  );
  const mod = (v: number, onChange: (v: number) => void) => (
    <select value={v} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>−1</option>
      <option value={0}>±0</option>
      <option value={1}>+1</option>
    </select>
  );
  const reroll = (v: Reroll, onChange: (v: Reroll) => void) => (
    <select value={v} onChange={(e) => onChange(e.target.value as Reroll)}>
      <option value="none">{t("no re-roll")}</option>
      <option value="ones">{t("re-roll 1s")}</option>
      <option value="failed">{t("re-roll fails")}</option>
    </select>
  );
  const s = suggestion;
  const coaching = useCoach.getState().lesson !== null && !useCoach.getState().free;

  return (
    <div className="spec">
      <p className="muted">
        {spec.kind === "melee"
          ? t("{inRange}/{carriers} models in engagement range", { inRange: s.inRange, carriers: s.carriers })
          : t("{inRange}/{carriers} models in range · {visible}/{targets} targets visible", {
              inRange: s.inRange,
              carriers: s.carriers,
              visible: s.visible,
              targets: s.targetModels,
            })}
        {s.inCover ? <> · {t("{n} in cover", { n: s.inCover })}</> : ""}
      </p>
      {s.notes.length > 0 && (
        <ul className="notes">
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {s.inRange === 0 && spec.kind === "ranged" && (
        <p className="warn">
          {rangeOf(game, spec)
            ? t("Out of range ({range})", { range: rangeOf(game, spec) })
            : t("Out of range")}
        </p>
      )}
      {declare ? (
        declare(spec)
      ) : s.inRange === 0 && spec.kind === "ranged" ? (
        <button disabled title={t("No model has the target in range, so there are no attacks to roll")}>
          {t("Declare attack")}
        </button>
      ) : s.inRange === 0 || s.visible === 0 ? (
        <button onClick={() => onDeclare(spec)} title={t("No models in range, or no target visible")}>
          {t("Declare anyway")}
        </button>
      ) : (
        <button className="primary" onClick={() => onDeclare(spec)}>
          {spec.kind === "melee" ? t("Fight") : t("Declare attack")}
        </button>
      )}
      {/* In a lesson the numbers fold away: the form is just weapon, target and Declare (PX review). */}
      <details className="more-options" open={!coaching && !game.settings.companion}>
        <summary>{t("More options")}</summary>
        <div className="grid">
          <label>
            {t("Attacks")}{" "}
            <input value={spec.attacks} onChange={(e) => set("attacks", e.target.value)} size={7} />
          </label>
          <label>
            {t("Hit")} {target(spec.hit, (v) => set("hit", v), t("auto"))}{" "}
            {mod(spec.hitMod, (v) => set("hitMod", v))} {reroll(spec.rerollHits, (v) => set("rerollHits", v))}
          </label>
          <label>
            {t("Sustained")}{" "}
            <input
              type="number"
              min={0}
              max={6}
              value={spec.sustained}
              onChange={(e) => set("sustained", Number(e.target.value))}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={spec.lethal} onChange={(e) => set("lethal", e.target.checked)} />{" "}
            {t("Lethal hits")}
          </label>
          <label>
            {t("Wound")} {target(spec.wound, (v) => set("wound", v ?? 6), "6+")}{" "}
            {mod(spec.woundMod, (v) => set("woundMod", v))}{" "}
            {reroll(spec.rerollWounds, (v) => set("rerollWounds", v))}
          </label>
          <label>
            {t("Crit wound on")} {target(spec.critWound, (v) => set("critWound", v ?? 6), "6+")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={spec.devastating}
              onChange={(e) => set("devastating", e.target.checked)}
            />{" "}
            {t("Devastating")}
          </label>
          <label>
            {t("Save")} {target(spec.save, (v) => set("save", v), t("none"))}{" "}
            {mod(spec.saveMod ?? 0, (v) => set("saveMod", v))}
          </label>
          <label>
            {t("Damage")}{" "}
            <input value={spec.damage} onChange={(e) => set("damage", e.target.value)} size={6} />{" "}
            {reroll(spec.rerollDamage ?? "none", (v) => set("rerollDamage", v))}
          </label>
          <label>
            {t("Feel no pain")} {target(spec.fnp, (v) => set("fnp", v), t("none"))}
          </label>
        </div>
      </details>
    </div>
  );
}

/** The weapon's range as its profile prints it. */
function rangeOf(game: GameState, spec: AttackSpec): string | undefined {
  const chars = game.units[spec.attackerUnitId]?.sheet?.weapons[spec.weaponId]?.chars;
  return chars?.Range ?? chars?.range;
}

const stageLabel = (stage: AttackState["stage"]): string =>
  ({
    hit: t("Roll to hit"),
    wound: t("Roll to wound"),
    save: t("Roll saves"),
    damage: t("Roll damage"),
    done: "",
  })[stage];

/** In the companion, what the other phone shows while this stage's roller rolls (UX 276). */
const waitingFor = (stage: AttackState["stage"], name: string): string =>
  ({
    hit: t("Waiting for {name} to roll to hit", { name }),
    wound: t("Waiting for {name} to roll to wound", { name }),
    save: t("Waiting for {name} to roll saves", { name }),
    damage: t("Waiting for {name} to roll damage", { name }),
    done: "",
  })[stage];

function AttackInProgress({ attack, live }: { attack: AttackState; live: boolean }) {
  const game = useGame();
  const { dispatch, role } = useStore();
  const { spec } = attack;
  const attacker = game.units[spec.attackerUnitId];
  const target = game.units[spec.targetUnitId];
  const canAct = live && role !== "spectator";
  const remaining = useMemo(() => stagesLeft(attack), [attack]);
  const volley = useVolley((v) => v.queue);
  // Saves are the defender's roll; everything else is the attacker's.
  const roller = attack.stage === "save" ? target?.owner : attacker?.owner;
  // Online, the saves wait for the defender; the attacker can still roll them, as dice hold no choices (UX 217).
  const canControl = useCanControl();
  const theirs = !!roller && attack.stage === "save" && !canControl(roller);
  // At a real table each player rolls their own dice on their own phone: the other phone waits (UX 276).
  const waiting = !!game.settings.companion && !!roller && !canControl(roller) && attack.stage !== "done";
  const rollerName = roller ? playerName(game.players[roller]) || t("Your opponent") : "";
  // In a lesson the computer rolls its own dice: the learner only sees them land.
  const botRolls = computerPlays(game, roller);
  const botAttacks = computerPlays(game, attacker?.owner);
  // The computer's attack, your saves: it rolls them for you if you don't (UX 404).
  const yourSaves = botAttacks && !botRolls && attack.stage === "save";
  // Rolling real dice (#37) goes a stage at a time, so each batch is asked for.
  const ownDice = useOwnDice((o) => o.own) && !!game.settings.companion;
  const rollAll = () => {
    for (let i = 0; i < remaining; i++) dispatch({ type: "attack/roll" }, roller);
  };
  // After the last roll its button goes: focus moves on to Done rather than dropping to the page (UX 199).
  const done = useRef<HTMLButtonElement>(null);
  const finished = attack.stage === "done";
  useEffect(() => {
    if (finished && (document.activeElement === document.body || !document.activeElement))
      done.current?.focus();
  }, [finished]);

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {attacker?.name} → {target?.name}: {spec.weaponName}
        </strong>
      </div>
      <p className="muted">
        {[
          tn(attack.attackCount, "{n} attack", "{n} attacks") +
            (attack.attackRolls.length
              ? ` ${t("(rolled {dice})", { dice: attack.attackRolls.join(" ") })}`
              : ""),
          t("hit {value}", {
            value: spec.hit === null ? t("auto") : stepValue(spec, "hit", spec.hit, spec.hitMod),
          }),
          t("wound {value}", { value: stepValue(spec, "wound", spec.wound, spec.woundMod) }),
          t("save {value}", {
            value: spec.save ? stepValue(spec, "save", spec.save, spec.saveMod ?? 0) : t("none"),
          }),
          t("D {value}", { value: damageValue(spec) }),
          ...(spec.fnp ? [t("FNP {value}", { value: `${spec.fnp}+` })] : []),
        ].join(" · ")}
      </p>
      {becauseText(spec) && <p className="muted small">{becauseText(spec)}</p>}
      {attack.hitDice && (
        <Stage label={t("Hits")} dice={attack.hitDice} judge={(v) => hitJudge(spec, v)}>
          {[
            // "1 hit (1 critical)": the criticals are among the hits, not extra (dogfood).
            tn(attack.hits ?? 0, "{n} hit", "{n} hits") +
              (attack.critHits ? ` (${t("{n} critical", { n: attack.critHits })})` : ""),
            ...(attack.autoWounds ? [t("{n} auto-wound", { n: attack.autoWounds })] : []),
          ].join(", ")}
        </Stage>
      )}
      {spec.hit === null && attack.hits !== undefined && !attack.hitDice && (
        <p>{t("Torrent: {n} automatic hits", { n: attack.hits })}</p>
      )}
      {attack.woundDice && (
        <Stage label={t("Wounds")} dice={attack.woundDice} judge={(v) => woundJudge(spec, v)}>
          {[
            tn(attack.wounds ?? 0, "{n} wound", "{n} wounds"),
            ...(attack.unsavable ? [t("{n} skip saves", { n: attack.unsavable })] : []),
          ].join(", ")}
        </Stage>
      )}
      {attack.saveDice && (
        <Stage
          label={t("Saves")}
          dice={attack.saveDice}
          judge={(v) => (spec.save !== null && passes(v, spec.save, spec.saveMod ?? 0) ? "ok" : "fail")}
        >
          {t("{n} unsaved", { n: attack.unsaved ?? "" })}
        </Stage>
      )}
      {attack.damage && <DamageSummary game={game} attack={attack} />}
      {live && target && (attack.stage === "save" || attack.stage === "damage") && !attack.damage && (
        <WoundOrder attack={attack} />
      )}
      {attacker && target && (
        <Reminders items={attackReminders(game, attacker.id, target.id, spec.kind)} live={live} />
      )}
      {canAct && botRolls && attack.stage !== "done" && (
        <p className="muted">{t("The computer is rolling…")}</p>
      )}
      {volley && volley.attackerId === spec.attackerUnitId && (
        <p className="muted small">
          {tn(
            volley.weapons.length,
            "Then {n} more weapon at this target",
            "Then {n} more weapons at this target",
          )}
        </p>
      )}
      {canAct && !(botRolls && botAttacks) && (
        <div className="row">
          {waiting && !botRolls && <span className="muted">{waitingFor(attack.stage, rollerName)}</span>}
          {attack.stage !== "done" && !botRolls && theirs && !waiting && (
            <>
              <span className="muted">{t("{name} rolls the saves", { name: rollerName })}</span>
              <RollButton
                className="quiet small"
                title={t("Dice hold no choices, so either player may roll them")}
                intent={{ type: "attack/roll" }}
                as={roller}
              >
                {t("Roll for them")}
              </RollButton>
            </>
          )}
          {attack.stage !== "done" && !botRolls && !theirs && !waiting && (
            <>
              <RollButton className="primary attack-roll" intent={{ type: "attack/roll" }} as={roller}>
                {stageLabel(attack.stage)}
                {yourSaves && <SelfRollCountdown />}
              </RollButton>
              {!botAttacks && !ownDice && <button onClick={rollAll}>{t("Roll everything")}</button>}
              {yourSaves && <RollsMineToggle />}
            </>
          )}
          {/* Calling off an attack is the attacker's choice; the other player gets Done at the end (dogfood). */}
          {!botAttacks && (attack.stage === "done" || !attacker || canControl(attacker.owner)) && (
            <button
              ref={done}
              className="attack-done"
              onClick={() => {
                // Cancelling one attack of "Shoot everything" stops the rest too.
                if (attack.stage !== "done") useVolley.setState({ queue: null });
                dispatch({ type: "attack/clear" }, attacker?.owner);
                focusSoon(".panel.unitcard");
              }}
            >
              {attack.stage === "done" ? t("Done") : t("Cancel")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function stagesLeft(a: AttackState): number {
  return (
    ["hit", "wound", "save", "damage", "done"].length -
    1 -
    ["hit", "wound", "save", "damage", "done"].indexOf(a.stage)
  );
}

function hitJudge(spec: AttackSpec, v: number): "crit" | "ok" | "fail" {
  if (v >= spec.critHit) return "crit";
  if (v === 1) return "fail";
  return v + Math.max(-1, Math.min(1, spec.hitMod)) >= (spec.hit ?? 0) ? "ok" : "fail";
}

function woundJudge(spec: AttackSpec, v: number): "crit" | "ok" | "fail" {
  if (v >= spec.critWound) return "crit";
  if (v === 1) return "fail";
  return v + Math.max(-1, Math.min(1, spec.woundMod)) >= spec.wound ? "ok" : "fail";
}

function Stage({
  label,
  dice,
  judge,
  children,
}: {
  label: string;
  dice: Die[];
  judge: (v: number) => "crit" | "ok" | "fail";
  children: React.ReactNode;
}) {
  const sorted = [...dice].sort((a, b) => b.value - a.value);
  return (
    <div className="stage">
      <span className="label">{label}</span>
      <span className="dice">
        {sorted.map((d, i) => (
          <span
            key={i}
            className={`die ${judge(d.value)}`}
            title={d.rerolledFrom ? t("re-rolled from {value}", { value: d.rerolledFrom }) : undefined}
          >
            {d.value}
            {d.rerolledFrom !== undefined && <sup>↻</sup>}
          </span>
        ))}
      </span>
      <span className="result">{children}</span>
    </div>
  );
}

function DamageSummary({ game, attack }: { game: GameState; attack: AttackState }) {
  const results = attack.damage ?? [];
  const lost = results.reduce((n, d) => n + d.lost, 0);
  const dead = results.filter((d) => d.destroyed).length;
  const fnpSaved = results.reduce((n, d) => n + d.fnp.filter((v) => v >= (attack.spec.fnp ?? 7)).length, 0);
  return (
    <div className="stage">
      <span className="label">{t("Damage")}</span>
      <span className="dice">
        {results.map((d, i) => (
          <span
            key={i}
            className={`die ${d.destroyed ? "crit" : "ok"}`}
            title={
              d.rerolledFrom !== undefined
                ? `${game.models[d.modelId]?.label ?? ""} · ${t("re-rolled from {n}", { n: d.rerolledFrom })}`
                : game.models[d.modelId]?.label
            }
          >
            {d.damage}
            {d.rerolledFrom !== undefined && <sup>↻</sup>}
          </span>
        ))}
      </span>
      <span className="result">
        <strong>
          {tn(dead, "{lost} wounds lost, {n} model destroyed", "{lost} wounds lost, {n} models destroyed", {
            lost,
          })}
        </strong>
        {attack.spec.fnp ? <> ({t("{n} ignored by feel no pain", { n: fnpSaved })})</> : ""}
      </span>
    </div>
  );
}

/**
 * The defender declares which models take wounds first (characters last,
 * a wounded model first). Shown before damage; anyone sees the order.
 */
function WoundOrder({ attack }: { attack: AttackState }) {
  const game = useGame();
  const { dispatch, set: setUi } = useStore();
  const canControl = useCanControl();
  const target = game.units[attack.spec.targetUnitId];
  if (!target) return null;
  const alive = aliveModels(game, target);
  // As the engine orders them: a wounded model first, then ordinary models,
  // then sergeants and special weapons; attached leaders come last in the unit already.
  const common = commonLoadout(alive);
  const rank = (m: (typeof alive)[number]) =>
    (m.woundsLost ?? 0) > 0 ? -1 : loadoutKey(m) === common ? 0 : 1;
  const fallback = alive
    .map((m, i) => ({ m, i }))
    .sort((x, y) => rank(x.m) - rank(y.m) || x.i - y.i)
    .map((x) => x.m);
  const chosen = attack.run?.overrides?.allocate?.order;
  const order = chosen
    ? [
        ...chosen.flatMap((id) => alive.filter((m) => m.id === id)),
        ...alive.filter((m) => !chosen.includes(m.id)),
      ]
    : fallback;
  // Neighbours with the same profile and weapons, unwounded, are one choice.
  const groups: (typeof alive)[] = [];
  for (const m of order) {
    const last = groups.at(-1);
    const same =
      last &&
      (m.woundsLost ?? 0) === 0 &&
      (last[0]!.woundsLost ?? 0) === 0 &&
      loadoutKey(m) === loadoutKey(last[0]);
    if (same) last.push(m);
    else groups.push([m]);
  }
  const mine = canControl(target.owner);
  const wounded = order.findIndex((m) => (m.woundsLost ?? 0) > 0);
  const toFront = (ids: string[]) =>
    dispatch(
      { type: "attack/allocate", order: [...ids, ...order.map((m) => m.id).filter((x) => !ids.includes(x))] },
      target.owner,
    );
  const point = (ids: string[] | null) => setUi({ hoverModels: ids });
  // What sets a special model apart: weapons the ordinary models don't carry.
  const usual = alive.find((m) => loadoutKey(m) === common)?.weapons ?? [];
  const gear = (m: (typeof alive)[number]) => {
    const extra = [...new Set((m.weapons ?? []).filter((w) => !usual.includes(w)))];
    const names = extra.map((w) => target.sheet?.weapons[w]?.name ?? w);
    return names.length ? ` (${names.join(", ")})` : "";
  };
  return (
    <div className="stage wound-order">
      <span className="label">{t("Wounds go to")}</span>
      <span className="chips" onMouseLeave={() => point(null)}>
        {groups.slice(0, 10).map((g, i) => {
          const m = g[0]!;
          const ids = g.map((x) => x.id);
          return (
            <button
              key={m.id}
              className={`chip ${i === 0 ? "on" : ""}`}
              disabled={!mine || i === 0}
              title={mine && i > 0 ? t("Take wounds on these models first") : undefined}
              onMouseEnter={() => point(ids)}
              onFocus={() => point(ids)}
              onBlur={() => point(null)}
              onClick={() => toFront(ids)}
            >
              {i + 1}. {m.label}
              {gear(m)}
              {g.length > 1 ? ` ×${g.length}` : ""}
              {(m.woundsLost ?? 0) > 0 ? <> ({t("{n} W left", { n: woundsLeft(m) })})</> : ""}
            </button>
          );
        })}
        {groups.length > 10 && <span className="muted">{t("+{n} more", { n: groups.length - 10 })}</span>}
      </span>
      <span className="result">
        {wounded > 0 ? (
          <span className="warn">{t("A model that has already lost wounds should take the next one.")}</span>
        ) : mine && !chosen && groups.length > 1 ? (
          <span className="muted">
            {touch()
              ? t("Defender: tap a model to put it first.")
              : t("Defender: click a model to put it first.")}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function woundsLeft(m: { woundsLost?: number; profile?: { chars: Record<string, string> } }): number {
  const w = Number.parseInt(m.profile?.chars.W ?? "1", 10) || 1;
  return w - (m.woundsLost ?? 0);
}
