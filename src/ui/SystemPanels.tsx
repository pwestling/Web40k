import { useMemo, useState, type ReactNode } from "react";
import {
  actionTargets,
  findProcedure,
  inchesPerUnit,
  previewRun,
  procedureEnv,
  procedureRoles,
  readCharacteristics,
  seatName,
  systemOf,
  unitActions,
  unitView,
  type ActionOption,
  type GameSystem,
  type StepPlan,
  type StepRecord,
} from "../core/content";
import { modelHeight, type GameState, type Unit } from "../core";
import { useCanControl, useStore, type AttackDraft } from "../store";
import { aliveModels, unitMoved } from "../systems/wh40k/rules";
import { useGame } from "./hooks";
import { eyeView, rotateUnit } from "./UnitCard";

/**
 * Panels for any game system, built from its data: a unit card with the
 * system's characteristics and statuses, the actions the unit can take now,
 * a setup panel for actions that run a procedure (an attack), the procedure
 * as it is rolled, and the reaction prompt. Systems with panels of their own
 * (40k) keep those.
 */

const unitName = (sys: GameSystem) =>
  typeof sys.units === "object" ? sys.units.name : sys.units === "cm" ? "cm" : '"';
const fmt = (n: number, sys: GameSystem) => {
  const u = unitName(sys);
  return `${Number(n.toFixed(1))}${u === '"' ? u : ` ${u}`}`;
};

export function SystemUnitCard({ unit, children }: { unit: Unit; children?: ReactNode }) {
  const game = useGame();
  const { select, dispatch, scrub, losFrom, set } = useStore();
  const canControl = useCanControl();
  const system = systemOf(game);
  const view = unitView(game, system, unit);
  const mine = canControl(unit.owner) && scrub === null;
  const owner = game.players[unit.owner];
  const all = unit.modelIds.flatMap((id) => game.models[id] ?? []);
  const alive = aliveModels(game, unit);
  const scale = inchesPerUnit(system);
  const allowance = typeof unit.status?.allowance === "number" ? unit.status.allowance : null;
  const moved = unitMoved(alive);
  const statuses = (system.statuses ?? []).filter((s) => view.statuses.includes(s.id));
  const flags = view.flags.filter(
    (f) =>
      !statuses.some((s) => s.id === f) &&
      !/^(acting|actionsTaken|actionBudget|allowance|reacting|box\d+|used\.)/.test(f),
  );
  const chars = system.characteristics.filter((c) => c.of === "model" && c.type !== "text");
  const texts = system.characteristics.filter((c) => c.of === "model" && c.type === "text");
  const weaponChars = system.characteristics.filter((c) => c.of === "weapon");
  const weapons = Object.values(unit.sheet?.weapons ?? {});
  const first = alive[0] ?? all[0];
  const raw = readCharacteristics(system, "model", first?.profile?.chars);

  return (
    <div className="panel unitcard">
      <div className="row spread">
        <h2 style={{ color: owner?.color }}>{unit.name}</h2>
        <button onClick={() => select(null)}>✕</button>
      </div>
      <p className="muted">
        {owner?.name} · {alive.length}/{all.length} {all.length === 1 ? "model" : "bases"}
        {unit.sheet?.points ? ` · ${unit.sheet.points} pts` : ""}
      </p>
      {children}
      {(statuses.length > 0 || flags.length > 0) && (
        <div className="chips">
          {statuses.map((s) => (
            <button
              key={s.id}
              className="chip on"
              disabled={!mine}
              title="Click to clear"
              onClick={() =>
                dispatch({ type: "unit/status", id: unit.id, key: s.id, value: null }, unit.owner)
              }
            >
              {s.name}
            </button>
          ))}
          {flags.map((f) => (
            <span key={f} className="chip on">
              {f}
            </span>
          ))}
        </div>
      )}
      {allowance !== null && (
        <p className={moved > allowance + 0.05 ? "warn" : "muted"}>
          Moved {fmt(moved / scale, system)} of {fmt(allowance / scale, system)} this round.
        </p>
      )}

      {mine && game.turn.round > 0 && <SystemActions unit={unit} />}

      <div className="row wrap">
        <button
          className={losFrom === unit.id ? "on" : ""}
          onClick={() => set({ losFrom: losFrom === unit.id ? null : unit.id })}
        >
          Line of sight
        </button>
        <button onClick={() => eyeView(unit.id)}>Model's eye view</button>
        {mine && (
          <>
            <button title="Rotate left (Q)" onClick={() => rotateUnit(unit.id, -1)}>
              ⟲
            </button>
            <button title="Rotate right (E)" onClick={() => rotateUnit(unit.id, 1)}>
              ⟳
            </button>
          </>
        )}
      </div>

      <table className="stats">
        <thead>
          <tr>
            {chars.map((c) => (
              <th key={c.id} title={c.name}>
                {c.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {chars.map((c) => {
              const v = view[c.id];
              const changed = v !== raw[c.id];
              return (
                <td
                  key={c.id}
                  className={changed ? "warn" : ""}
                  title={changed ? `${raw[c.id]} on the card` : undefined}
                >
                  {v === null || v === undefined ? "–" : String(v)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {texts.map((c) =>
        view[c.id] ? (
          <p key={c.id} className="small">
            <strong>{c.name}:</strong> {String(view[c.id])}
          </p>
        ) : null,
      )}

      {weapons.length > 0 && (
        <table className="weapons">
          <thead>
            <tr>
              <th>Weapon</th>
              {weaponChars.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weapons.map((w) => {
              const v = readCharacteristics(system, "weapon", w.chars);
              return (
                <tr key={w.id}>
                  <td>
                    {w.name}
                    {w.keywords.length > 0 && <div className="muted small">{w.keywords.join(", ")}</div>}
                  </td>
                  {weaponChars.map((c) => (
                    <td key={c.id}>{v[c.id] === null ? "–" : String(v[c.id])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {unit.sheet && unit.sheet.keywords.length > 0 && (
        <p className="muted small">{unit.sheet.keywords.join(", ")}</p>
      )}

      <details>
        <summary>Bases</summary>
        <ul className="models">
          {all.map((m) => (
            <li key={m.id} className={m.destroyed ? "dead" : ""}>
              <span>{m.label}</span>
              <span>{m.destroyed ? "removed" : `${modelHeight(m).toFixed(1)}" tall`}</span>
              {mine && (
                <button
                  className="small"
                  onClick={() =>
                    dispatch(
                      {
                        type: "model/wounds",
                        id: m.id,
                        woundsLost: m.destroyed ? 0 : 1,
                        destroyed: !m.destroyed,
                      },
                      unit.owner,
                    )
                  }
                >
                  {m.destroyed ? "Return" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** The actions this unit can take now, as buttons; ones it can't take say why. */
function SystemActions({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, setDraft } = useStore();
  const [commanding, setCommanding] = useState<{ action: string; picked: string[] } | null>(null);
  const options = unitActions(game, unit.id);
  const status = unit.status ?? {};
  const acting = !!status.acting;
  const reacting = !!status.reacting;
  // Reactions only show while one can be made.
  const shown = options.filter((o) => !o.def.reactTo || o.ok);
  const take = (o: ActionOption, extra: { with?: string[] } = {}) => {
    if (o.def.procedure) {
      setDraft({ attackerId: unit.id, kind: "ranged", action: o.def.id, picking: true });
      return;
    }
    dispatch({ type: "action/take", unitId: unit.id, action: o.def.id, ...extra }, unit.owner);
  };
  const click = (o: ActionOption) => {
    if (o.commands && o.commands.count > 0 && o.commands.candidates.length > 0)
      setCommanding({ action: o.def.id, picked: [] });
    else take(o);
  };
  const commandOption = commanding && options.find((o) => o.def.id === commanding.action);

  return (
    <div className="actions">
      {acting && (
        <p className="muted small">
          {reacting ? "Reacting" : "Activated"}: {Number(status.actionsTaken ?? 0)} of{" "}
          {Number(status.actionBudget ?? 0)} actions used.
        </p>
      )}
      <div className="row wrap">
        {shown.map((o) => (
          <button
            key={o.def.id}
            className={o.ok ? "primary" : ""}
            disabled={!o.ok}
            title={o.why ?? (o.cost ? `Costs ${o.cost}` : undefined)}
            onClick={() => click(o)}
          >
            {o.def.name}
            {o.move !== undefined ? ` ${o.move}` : ""}
            {o.cost ? <span className="cost"> · {o.cost}</span> : null}
          </button>
        ))}
      </div>
      {shown.some((o) => !o.ok) && (
        <p className="muted small">
          {[...new Set(shown.filter((o) => !o.ok && o.why).map((o) => `${o.def.name}: ${o.why}`))].join(
            " · ",
          )}
        </p>
      )}
      {commandOption?.commands && commanding && (
        <div className="command">
          <p className="small">
            Also activate up to {commandOption.commands.count} unit
            {commandOption.commands.count === 1 ? "" : "s"}:
          </p>
          {commandOption.commands.candidates.map((id) => (
            <label key={id} className="check">
              <input
                type="checkbox"
                checked={commanding.picked.includes(id)}
                disabled={
                  !commanding.picked.includes(id) && commanding.picked.length >= commandOption.commands!.count
                }
                onChange={(e) =>
                  setCommanding({
                    ...commanding,
                    picked: e.target.checked
                      ? [...commanding.picked, id]
                      : commanding.picked.filter((x) => x !== id),
                  })
                }
              />{" "}
              {game.units[id]?.name}
            </label>
          ))}
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                take(commandOption, { with: commanding.picked });
                setCommanding(null);
              }}
            >
              {commandOption.def.name}
              {commanding.picked.length ? ` with ${commanding.picked.length}` : ""}
            </button>
            <button onClick={() => setCommanding(null)}>Cancel</button>
          </div>
        </div>
      )}
      {acting && !reacting && (
        <button onClick={() => dispatch({ type: "turn/endActivation" }, unit.owner)}>End activation</button>
      )}
      {reacting && (
        <button onClick={() => dispatch({ type: "reaction/pass" }, unit.owner)}>Finish reaction</button>
      )}
    </div>
  );
}

/** Choose the weapon and target for a procedure action such as Fire, with the numbers it will use. */
export function ActionSetup({ draft }: { draft: AttackDraft & { action: string } }) {
  const game = useGame();
  const { setDraft, dispatch } = useStore();
  const unit = game.units[draft.attackerId];
  const system = systemOf(game);
  const def = system.actions.find((a) => a.id === draft.action);
  const weapons = Object.values(unit?.sheet?.weapons ?? {});
  const options = useMemo(
    () =>
      unit
        ? weapons.map((w) => ({
            w,
            o: unitActions(game, unit.id, { weapon: w.id }).find((o) => o.def.id === draft.action),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, unit?.id, draft.action],
  );
  const weaponId = draft.weaponId ?? options.find((x) => x.o?.ok)?.w.id ?? weapons[0]?.id;
  const targets = unit && def ? actionTargets(game, unit.id, def.id) : [];
  const scale = inchesPerUnit(system);
  const chosen = options.find((x) => x.w.id === weaponId);
  const ready = chosen?.o && draft.targetId;
  const option = ready
    ? unitActions(game, unit!.id, { weapon: weaponId, targetId: draft.targetId }).find(
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

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {unit.name}: {def.name}
        </strong>
        <button onClick={() => setDraft(null)}>Cancel</button>
      </div>
      <div className="row wrap">
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
        <span>at</span>
        <select
          value={draft.targetId ?? ""}
          onChange={(e) => setDraft({ ...draft, targetId: e.target.value || undefined, picking: false })}
        >
          <option value="">Target…</option>
          {targets.map((t) => (
            <option key={t.unitId} value={t.unitId}>
              {game.units[t.unitId]?.name} ({fmt(t.distance, system)}
              {t.ok ? "" : ", not visible"})
            </option>
          ))}
        </select>
        <button
          className={draft.picking ? "on" : ""}
          onClick={() => setDraft({ ...draft, picking: !draft.picking })}
        >
          {draft.picking ? "Click a target on the table…" : "Pick on table"}
        </button>
      </div>
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
      <button
        className="primary"
        disabled={!option?.ok}
        onClick={() => {
          dispatch(
            {
              type: "action/take",
              unitId: unit.id,
              action: def.id,
              weapon: weaponId,
              targetId: draft.targetId,
            },
            unit.owner,
          );
          setDraft(null);
        }}
      >
        {def.name}
        {option?.cost ? ` (${option.cost})` : ""}
      </button>
      <p className="muted small">
        Distances in {unitName(system) === '"' ? "inches" : unitName(system)} ({scale}" each).
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

/** "pinInfantry" → "Pin infantry". */
function label(id: string): string {
  const words = id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describePlan(plan: StepPlan | undefined): string | null {
  if (!plan) return null;
  if (plan.kind === "pool") return `${plan.count} dice`;
  if (plan.kind === "damage") return `${plan.amount} each`;
  if (plan.kind !== "test") return null;
  if (plan.skip) return "skipped";
  const dice = `${plan.dicePerInput > 1 ? `${plan.dicePerInput}×` : ""}${plan.sumOf > 1 ? plan.sumOf : ""}d${plan.sides}${plan.keep && plan.dicePerInput > 1 ? ` keep ${plan.keep}` : ""}`;
  if (plan.target === null) return `${dice}: can't succeed`;
  // A target of 0 means each die is judged against the roll it answers (opposed saves).
  const vs =
    plan.target === 0
      ? "vs each hit roll"
      : plan.compare === "atLeast"
        ? `${plan.target}+`
        : `${plan.target} or less`;
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
  const notes = run.outcomes.filter((o) => o.kind === "note" || o.kind === "reminder");
  const lost = run.outcomes.filter((o) => o.kind === "wounds").length;
  const destroyed = run.outcomes.some((o) => o.kind === "destroy");
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
          <RecordRow key={i} record={r} />
        ))}
      {run.pending && (
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
              Pass
            </button>
          </span>
        </div>
      )}
      {run.done && (
        <p>
          <strong>
            {destroyed ? "Unit destroyed" : `${lost} base${lost === 1 ? "" : "s"} lost`}
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
      {live && (
        <div className="row">
          {next && !run.pending && (
            <button className="primary" onClick={() => dispatch({ type: "procedure/roll" }, roller)}>
              Roll {label(next.id).toLowerCase()}
            </button>
          )}
          <button onClick={() => dispatch({ type: "procedure/clear" }, proc.by)}>
            {run.done ? "Done" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}

function RecordRow({ record: r }: { record: StepRecord }) {
  const kept = r.dice ?? [];
  return (
    <div className="stage">
      <span className="label">{label(r.id)}</span>
      <span className="dice">
        {r.kind === "pool" && <span className="muted">{r.out} dice</span>}
        {kept.map((d, i) => (
          <span
            key={i}
            className={`die ${d.success ? (d.critical ? "crit" : "ok") : "fail"}`}
            title={d.dice && d.dice.length > 1 ? `rolled ${d.dice.join(", ")}` : undefined}
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
      {r.dice && (
        <span className="result">
          {r.successes ?? 0} of {r.in}{" "}
          {r.plan.kind === "test" && r.plan.passOn === "failures" ? "saved" : "succeed"}
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
    if (game.players[u.owner]?.seat !== pending.seat) return [];
    const o = unitActions(game, u.id).find((x) => x.def.reactTo && x.ok);
    return o ? [{ unit: u, option: o }] : [];
  });
  const what = `${actor?.name ?? "A unit"}: ${action}${target ? ` at ${target.name}` : ""}`;

  return (
    <div className="panel reaction">
      {reactor ? (
        <p>
          <strong>{reactor.name}</strong> is reacting to {what}.{" "}
          {mine ? "Take its action, then finish the reaction." : `Waiting on ${who}.`}
        </p>
      ) : mine ? (
        <>
          <p>
            <strong>{who}</strong>, react to {what}?
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
            <button onClick={() => dispatch({ type: "reaction/pass" }, deciding?.id)}>Don't react</button>
          </div>
        </>
      ) : (
        <p>
          {what}. Waiting on <strong>{who}</strong> to decide whether to react.
        </p>
      )}
      {reactor && mine && (
        <button onClick={() => dispatch({ type: "reaction/pass" }, deciding?.id)}>Finish reaction</button>
      )}
    </div>
  );
}
