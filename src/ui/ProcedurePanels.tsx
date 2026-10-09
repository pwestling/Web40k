import { PoolPicker, usesFaces } from "./SystemPanels";
import { RollsMineToggle, SelfRollCountdown } from "../bot/SelfRoll";
import { RollButton } from "../companion/RealDice";
import { useMemo, useState } from "react";
import {
  actionTargets,
  findProcedure,
  inchesPerUnit,
  previewRun,
  procedureEnv,
  procedureRoles,
  seatName,
  systemOf,
  unitActions,
  type StepPlan,
  type StepRecord,
} from "../core/content";
import { type GameState, type Unit } from "../core";
import { inArc } from "../core/regiment";
import { lossText } from "./gameLog";
import { useCanControl, useStore, type AttackDraft } from "../store";
import { useGame } from "./hooks";
import { computerPlays } from "../teach/store";
import { t, gameText } from "../i18n";
import { lengthText, unitSymbol } from "./distance";
import { rangeNote } from "./rangeNote";

/**
 * A rules procedure on screen: setting one up (who, with what, at whom), its
 * steps as they resolve, and a reaction the other side is offered.
 */

/**
 * Whether a preview has a dice step that can't succeed and that hurts the
 * one rolling it. An impossible save (passes on failures) or morale test
 * (failures add to the input) is good for the attacker, not a reason it
 * "can't hit".
 */
const cannotSucceed = (preview: { plans: Record<string, StepPlan> } | null) =>
  !!preview &&
  Object.values(preview.plans).some(
    (p) =>
      p.kind === "test" &&
      !p.skip &&
      p.target === null &&
      p.passOn !== "failures" &&
      p.passOn !== "inputPlusFailures",
  );

/** "Rear charge: every Resolve test fails", or without the cause when the attacker isn't behind. */
function everyTestFails(
  stepId: string,
  target: Unit | undefined,
  attacker: Unit | undefined,
  game: GameState,
) {
  const step = label(stepId);
  const behind = target && attacker && inArc(game, target, attacker) === "rear";
  return behind
    ? t("Rear charge: every {step} test fails", { step })
    : t("Every {step} test fails", { step });
}

/** Choose the weapon and target for a procedure action such as Fire, with the numbers it will use. */
export function ActionSetup({ draft }: { draft: AttackDraft & { action: string } }) {
  const game = useGame();
  const { setDraft, dispatch } = useStore();
  const [pick, setPick] = useState<number | null>(null);
  // A multiple attack's other targets, by attack (the first target where none is picked).
  const [more, setMore] = useState<string[]>([]);
  const unit = game.units[draft.attackerId];
  const system = systemOf(game);
  const def = system.actions.find((a) => a.id === draft.action);
  const dice = pick !== null ? { dice: [pick] } : {};
  const weapons = Object.values(unit?.sheet?.weapons ?? {});
  const options = useMemo(
    () =>
      unit
        ? weapons.map((w) => ({
            w,
            o: unitActions(game, unit.id, { weapon: w.id, ...dice }).find((o) => o.def.id === draft.action),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, unit?.id, draft.action, pick],
  );
  // Procedures without a weapon (Conquest's Clash and Volley) skip the weapon picker.
  const armed = !!def?.procedure && (findProcedure(system, def.procedure).params ?? []).includes("weapon");
  const weaponId = armed
    ? (draft.weaponId ?? options.find((x) => x.o?.ok)?.w.id ?? weapons[0]?.id)
    : undefined;
  const targets = unit && def ? actionTargets(game, unit.id, def.id, weaponId) : [];
  const scale = inchesPerUnit(system);
  const chosen = options.find((x) => x.w.id === weaponId);
  const ready = (armed ? chosen?.o : unit) && draft.targetId;
  const option = ready
    ? unitActions(game, unit!.id, { weapon: weaponId, targetId: draft.targetId, ...dice }).find(
        (o) => o.def.id === draft.action,
      )
    : undefined;
  if (!unit || !def?.procedure) return null;
  const preview = ready
    ? safePreview(
        game,
        def.procedure,
        procedureRoles(system, def.procedure, unit.id, { weapon: weaponId, targetId: draft.targetId }),
      )
    : null;
  const weapon = weaponId ? unit.sheet?.weapons[weaponId] : undefined;
  // Each target's range note, from a preview of the roll against it.
  const notes = Object.fromEntries(
    targets.map((tg) => {
      const p =
        weaponId || !armed
          ? safePreview(
              game,
              def.procedure!,
              procedureRoles(system, def.procedure!, unit.id, { weapon: weaponId, targetId: tg.unitId }),
            )
          : null;
      return [tg.unitId, rangeNote(system, weapon, tg.distance, cannotSucceed(p))];
    }),
  );
  const hopeless = cannotSucceed(preview);
  const repeat = chosen?.o?.repeat ?? 1;
  const moreTargets = Array.from({ length: repeat - 1 }, (_, i) => more[i] ?? draft.targetId ?? "");

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {unit.name}: {gameText(def.name)}
        </strong>
        <button onClick={() => setDraft(null)}>{t("Cancel")}</button>
      </div>
      <div className="row wrap">
        {armed && (
          <select
            value={weaponId ?? ""}
            onChange={(e) => setDraft({ ...draft, weaponId: e.target.value || undefined })}
          >
            {options.map(({ w, o }) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {o?.cost ? ` (${o.cost})` : ""}
                {o && !o.ok ? `: ${o.why}` : ""}
              </option>
            ))}
          </select>
        )}
        <span>{t("at")}</span>
        <select
          value={draft.targetId ?? ""}
          onChange={(e) => setDraft({ ...draft, targetId: e.target.value || undefined, picking: false })}
        >
          <option value="">{t("Target…")}</option>
          {targets.map((tg) => (
            <option key={tg.unitId} value={tg.unitId}>
              {game.units[tg.unitId]?.name} ({lengthText(system, tg.distance * scale)}
              {tg.ok ? "" : `, ${tg.why ? gameText(tg.why) : t("not visible")}`}
              {notes[tg.unitId] ? `, ${notes[tg.unitId]}` : ""})
            </option>
          ))}
        </select>
        <button
          className={draft.picking ? "on" : ""}
          onClick={() => setDraft({ ...draft, picking: !draft.picking })}
        >
          {draft.picking ? t("Click a target on the table…") : t("Pick on table")}
        </button>
      </div>
      {draft.targetId && repeat > 1 && (
        <div className="row wrap">
          {moreTargets.map((id, i) => (
            <label key={i}>
              {t("Attack {n} at", { n: i + 2 })}{" "}
              <select
                value={id}
                onChange={(e) => setMore(moreTargets.map((x, j) => (j === i ? e.target.value : x)))}
              >
                {targets.map((tg) => (
                  <option key={tg.unitId} value={tg.unitId}>
                    {game.units[tg.unitId]?.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {preview && (
        <ul className="plan">
          {findProcedure(system, def.procedure).steps.map((step) => {
            const text = describePlan(preview.plans[step.id]);
            return text ? (
              <li key={step.id}>
                <span className="label">{label(step.id)}</span> {text}
                {preview.fired[step.id]?.length ? (
                  <span className="muted"> ({preview.fired[step.id]!.join(", ")})</span>
                ) : null}
              </li>
            ) : null;
          })}
        </ul>
      )}
      {option && !option.ok && <p className="warn">{option.why}</p>}
      {!draft.targetId && (
        <p className="muted small">{t("Pick a target first: from the list, or on the table.")}</p>
      )}
      {option?.ok && hopeless && draft.targetId && (
        <p className="warn">
          {t("{reason}: no roll can succeed.", {
            reason: (notes[draft.targetId] ?? t("can't hit")).replace(/^./, (c) => c.toUpperCase()),
          })}
        </p>
      )}
      {option?.payment.some((p) => p.indices) && (
        <PoolPicker owner={unit.owner} pick={pick} hover={[]} onPick={setPick} />
      )}
      <button
        className={hopeless ? "" : "primary"}
        disabled={!option?.ok}
        // Why it can't go yet, before a target is picked (UX 266).
        title={!draft.targetId ? t("Pick a target first") : option && !option.ok ? option.why : undefined}
        onClick={() => {
          dispatch(
            {
              type: "action/take",
              unitId: unit.id,
              action: def.id,
              weapon: weaponId,
              targetId: draft.targetId,
              ...(repeat > 1 ? { more: moreTargets } : {}),
              ...dice,
            },
            unit.owner,
          );
          setDraft(null);
        }}
      >
        {gameText(def.name)}
        {hopeless ? ` ${t("anyway")}` : ""}
        {option?.faces?.length ? ` (${usesFaces(option.faces)})` : option?.cost ? ` (${option.cost})` : ""}
      </button>
      <p className="muted small">
        {t('Distances in {units} ({scale}" each).', {
          units: unitSymbol(system) === '"' ? t("inches") : unitSymbol(system),
          scale,
        })}
      </p>
    </div>
  );
}

function safePreview(game: GameState, procedure: string, roles: ReturnType<typeof procedureRoles>) {
  try {
    return previewRun(procedureEnv(game), procedure, roles);
  } catch {
    return null;
  }
}

/** "pinInfantry" → "Pin infantry", "resolve_flanked" → "Resolve flanked". */
function label(id: string): string {
  const words = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describePlan(plan: StepPlan | undefined): string | null {
  if (!plan) return null;
  if (plan.kind === "pool")
    return plan.why
      ? t("{count} dice ({why})", { count: plan.count, why: plan.why })
      : t("{count} dice", { count: plan.count });
  if (plan.kind === "damage") return t("{amount} each", { amount: plan.amount });
  if (plan.kind !== "test") return null;
  if (plan.skip) return t("skipped");
  const keep =
    plan.keep && plan.dicePerInput > 1
      ? ` ${plan.keep === "highest" ? t("keep highest") : t("keep lowest")}`
      : "";
  const dice = `${plan.dicePerInput > 1 ? `${plan.dicePerInput}×` : ""}${plan.sumOf > 1 ? plan.sumOf : ""}d${plan.sides}${keep}`;
  if (plan.target === null)
    return plan.passOn === "failures"
      ? t("no save")
      : plan.passOn === "inputPlusFailures"
        ? t("{dice}: every test fails", { dice })
        : t("{dice}: can't succeed", { dice });
  // A target of 0 means each die is judged against the roll it answers (opposed saves).
  const vs =
    plan.target === 0
      ? t("vs each hit roll")
      : plan.compare === "atLeast"
        ? `${plan.target}+`
        : t("{target} or less", { target: plan.target });
  return `${dice} ${vs}${plan.modifier ? ` (${plan.modifier > 0 ? "+" : ""}${plan.modifier})` : ""}`;
}

/** The procedure being rolled: every step's dice, the open window, and what happened. */
export function ProcedurePanel() {
  const game = useGame();
  const { dispatch, role, scrub } = useStore();
  const proc = game.procedure;
  if (!proc) return null;
  const system = systemOf(game);
  const steps = findProcedure(system, proc.run.procedure).steps;
  const run = proc.run;
  const live = scrub === null && role !== "spectator";
  const next = run.done ? null : steps[run.next];
  const target = proc.targetId ? game.units[proc.targetId] : undefined;
  const defender = target?.owner;
  // Rolls go through the attacker; the defender answers windows on their side.
  const roller = next && next.kind === "test" && next.roller === "defender" ? defender : proc.by;
  // In a lesson the computer rolls and answers for its own side.
  const botRolls = computerPlays(game, roller);
  const botAnswers = computerPlays(game, defender);
  const botActs = computerPlays(game, proc.by);
  // The computer's action, your roll (saves): it rolls it for you if you don't (UX 404).
  const yours = botActs && !botRolls && !run.done;
  const notes = run.outcomes.filter((o) => o.kind === "note" || o.kind === "reminder");
  const actor = game.units[proc.unitId];
  const weapon = proc.weapon ? actor?.sheet?.weapons[proc.weapon] : undefined;
  const distance =
    proc.targetId && actor
      ? actionTargets(game, actor.id, proc.action).find((t) => t.unitId === proc.targetId)?.distance
      : undefined;
  // A step that couldn't succeed says why, e.g. "out of range", rather than a bare "0 of 3".
  const whyNone = (r: StepRecord) =>
    r.plan.kind === "test" && r.plan.target === null && r.plan.passOn === "failures"
      ? t("no save possible")
      : r.plan.kind === "test" && r.plan.target === null && r.plan.passOn === "inputPlusFailures"
        ? everyTestFails(r.id, target, actor, game)
        : r.plan.kind === "test" && r.plan.target === null
          ? ((distance !== undefined ? rangeNote(system, weapon, distance, true) : null) ??
            t("can't succeed"))
          : undefined;
  const loss = lossText(game, run.outcomes);
  const statuses = [
    ...new Set(
      run.outcomes.flatMap((o) =>
        o.kind === "status" && o.value && !o.status.startsWith("box")
          ? [system.statuses?.find((s) => s.id === o.status)?.name ?? o.status]
          : [],
      ),
    ),
  ];

  return (
    <div className="panel attack">
      <strong>{proc.title}</strong>
      {run.records
        .filter((r) => r.dice?.length || r.rolls?.length || r.damage?.length || r.kind === "pool")
        .map((r, i) => (
          <RecordRow key={i} record={r} why={whyNone(r)} />
        ))}
      {run.pending && !botAnswers && (
        <div className="stage">
          <span className="label">{label(run.pending.step)}</span>
          <span className="row wrap">
            {run.pending.options.map((o) => (
              <button
                key={o.id}
                disabled={!live}
                onClick={() => dispatch({ type: "procedure/respond", answer: o.id }, defender)}
              >
                {o.label}
              </button>
            ))}
            <button
              disabled={!live}
              onClick={() => dispatch({ type: "procedure/respond", answer: "pass" }, defender)}
            >
              {t("Pass")}
            </button>
          </span>
        </div>
      )}
      {run.done && (
        <p>
          <strong>
            {loss === "destroyed" ? t("Unit destroyed") : loss.replace(/^./, (c) => c.toUpperCase())}
            {statuses.length ? ` · ${statuses.join(", ")}` : ""}
          </strong>
        </p>
      )}
      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i}>{"text" in n ? n.text : ""}</li>
          ))}
        </ul>
      )}
      {live && next && (botRolls || (run.pending && botAnswers)) && (
        <p className="muted">{t("The computer is rolling…")}</p>
      )}
      {live && !(botActs && (botRolls || run.done)) && (
        <div className="row">
          {next && !run.pending && !botRolls && (
            <RollButton className="primary" intent={{ type: "procedure/roll" }} as={roller}>
              {t("Roll {step}", { step: label(next.id).toLowerCase() })}
              {yours && <SelfRollCountdown />}
            </RollButton>
          )}
          {yours && next && !run.pending && <RollsMineToggle />}
          {!botActs && (
            <button onClick={() => dispatch({ type: "procedure/clear" }, proc.by)}>
              {run.done ? t("Done") : t("Cancel")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RecordRow({ record: r, why }: { record: StepRecord; why?: string }) {
  const kept = r.dice ?? [];
  return (
    <div className="stage">
      <span className="label">{label(r.id)}</span>
      <span className="dice">
        {r.kind === "pool" && <span className="muted">{t("{count} dice", { count: r.out })}</span>}
        {kept.map((d, i) => (
          <span
            key={i}
            className={`die ${d.success ? (d.critical ? "crit" : "ok") : "fail"}`}
            title={d.dice && d.dice.length > 1 ? t("rolled {dice}", { dice: d.dice.join(", ") }) : undefined}
          >
            {d.value}
          </span>
        ))}
        {r.damage?.map((d, i) => (
          <span key={`d${i}`} className={`die ${d.destroyed ? "crit" : "ok"}`}>
            {d.lost}
          </span>
        ))}
      </span>
      {r.plan.kind === "test" && !r.in && <span className="result muted">{t("nothing to roll")}</span>}
      {r.dice && r.in > 0 && (
        <span className="result">
          {r.plan.kind === "test" && r.plan.passOn === "failures"
            ? t("{successes} of {count} saved", { successes: r.successes ?? 0, count: r.in })
            : t("{successes} of {count} succeed", { successes: r.successes ?? 0, count: r.in })}
          {/* What each die needed, kept once rolled (dogfood #54: the Hit row hid it). */}
          {r.plan.kind === "test" && r.plan.target !== null && !r.plan.skip ? (
            <span className="muted"> · {describePlan(r.plan)}</span>
          ) : null}
          {why ? <span className="warn">: {why}</span> : null}
        </span>
      )}
    </div>
  );
}

/** While an action waits on a reaction: who is deciding, and for them, the units that can react. */
export function ReactionPrompt() {
  const game = useGame();
  const { dispatch, select, scrub } = useStore();
  const canControl = useCanControl();
  const pending = game.pending;
  if (!pending || scrub !== null) return null;
  const trigger = pending.trigger;
  const actor = game.units[trigger.unitId];
  const target = trigger.targetId ? game.units[trigger.targetId] : undefined;
  const system = systemOf(game);
  const action = system.actions.find((a) => a.id === trigger.action)?.name ?? trigger.action;
  const who = seatName(game, pending.seat);
  const reactor = pending.reactor ? game.units[pending.reactor] : undefined;
  const deciding = Object.values(game.players).find((p) => p.seat === pending.seat);
  const mine = deciding ? canControl(deciding.id) : false;
  const reactors = Object.values(game.units).flatMap((u) => {
    // Units still in reserve aren't on the table to react (UX 293).
    if (game.players[u.owner]?.seat !== pending.seat || u.status?.reserves) return [];
    const o = unitActions(game, u.id).find((x) => x.def.reactTo && x.ok);
    return o ? [{ unit: u, option: o }] : [];
  });
  const actorName = actor?.name ?? t("A unit");
  // Prepared tokens on the deciding side: their effects may apply now (UX 294).
  const prepared = Object.values(game.units).flatMap((u) =>
    game.players[u.owner]?.seat !== pending.seat
      ? []
      : Object.keys(u.status ?? {})
          .filter((k) => k.startsWith("prepared.") && u.status?.[k])
          .flatMap((k) => {
            const w = u.sheet?.weapons[k.slice("prepared.".length)];
            return w ? [{ unit: u, weapon: w }] : [];
          }),
  );
  const what = target
    ? t("{unit}: {action} at {target}", { unit: actorName, action, target: target.name })
    : `${actorName}: ${action}`;

  return (
    <div className="panel reaction">
      {reactor ? (
        <p>
          <strong>{reactor.name}</strong> {t("is reacting to {what}.", { what })}{" "}
          {mine ? t("Take its action, then finish the reaction.") : t("Waiting on {name}.", { name: who })}
        </p>
      ) : mine ? (
        <>
          <p>
            <strong>{who}</strong>, {t("react to {what}?", { what })}
          </p>
          <div className="row wrap">
            {reactors.map(({ unit, option }) => (
              <button
                key={unit.id}
                className="primary"
                onClick={() => {
                  dispatch({ type: "action/take", unitId: unit.id, action: option.def.id }, unit.owner);
                  select(unit.id);
                }}
              >
                {unit.name}
                {option.cost ? ` (${option.cost})` : ""}
              </button>
            ))}
            <button onClick={() => dispatch({ type: "reaction/pass" }, deciding?.id)}>
              {t("Don't react")}
            </button>
          </div>
        </>
      ) : (
        <p>
          {what}. {t("Waiting on {name} to decide whether to react.", { name: who })}
        </p>
      )}
      {prepared.map(({ unit, weapon }) => (
        <p key={`${unit.id}/${weapon.id}`} className="muted small">
          {t("{unit}'s {weapon} is prepared: check whether {actor} is within its range of {range}.", {
            unit: unit.name,
            weapon: weapon.name,
            actor: actorName,
            range: weapon.chars.RANGE ?? weapon.chars.Range ?? "–",
          })}
        </p>
      ))}
      {reactor && mine && (
        <button onClick={() => dispatch({ type: "reaction/pass" }, deciding?.id)}>
          {t("Finish reaction")}
        </button>
      )}
    </div>
  );
}
