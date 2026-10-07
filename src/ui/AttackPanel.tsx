import { useMemo, useState } from "react";
import type { AttackSpec, AttackState, Die, GameState, Reroll } from "../core";
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
import { ActionSetup, ProcedurePanel } from "./SystemPanels";

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
    .filter((u) => u.owner !== attacker.owner && aliveModels(game, u).length > 0)
    .map((u) => {
      const distance = unitDistance(shooters, aliveModels(game, u));
      return { unit: u, distance, out: reach !== null && distance > reach };
    })
    .sort((a, b) => Number(a.out) - Number(b.out) || a.distance - b.distance);
  const suggestion =
    weaponId && draft.targetId ? suggestAttack(game, attacker.id, weaponId, draft.targetId) : null;

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {attacker.name}: {draft.kind === "ranged" ? "shoot" : "fight"}
        </strong>
        <button onClick={() => setDraft(null)}>Cancel</button>
      </div>
      <div className="row wrap">
        <select
          value={weaponId ?? ""}
          onChange={(e) => setDraft({ ...draft, weaponId: e.target.value || undefined })}
        >
          <option value="">Weapon…</option>
          {weapons.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} (×{w.count})
            </option>
          ))}
        </select>
        <span>at</span>
        <select
          value={draft.targetId ?? ""}
          onChange={(e) => setDraft({ ...draft, targetId: e.target.value || undefined, picking: false })}
        >
          <option value="">Target…</option>
          {enemies.map(({ unit: u, distance, out }) => (
            <option key={u.id} value={u.id}>
              {u.name} ({distance.toFixed(1)}"{out ? ", out of range" : ""})
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
      {suggestion && (
        <SpecEditor
          key={`${weaponId}|${draft.targetId}`}
          suggestion={suggestion}
          onDeclare={(spec) => {
            dispatch({ type: "attack/declare", spec }, attacker.owner);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

function SpecEditor({
  suggestion,
  onDeclare,
}: {
  suggestion: AttackSuggestion;
  onDeclare: (spec: AttackSpec) => void;
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
      <option value="none">no re-roll</option>
      <option value="ones">re-roll 1s</option>
      <option value="failed">re-roll fails</option>
    </select>
  );
  const s = suggestion;

  return (
    <div className="spec">
      <p className="muted">
        {s.inRange}/{s.carriers} models in range · {s.visible}/{s.targetModels} targets visible
        {s.inCover ? ` · ${s.inCover} in cover` : ""}
      </p>
      {s.notes.length > 0 && (
        <ul className="notes">
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="grid">
        <label>
          Attacks <input value={spec.attacks} onChange={(e) => set("attacks", e.target.value)} size={7} />
        </label>
        <label>
          Hit {target(spec.hit, (v) => set("hit", v), "auto")} {mod(spec.hitMod, (v) => set("hitMod", v))}{" "}
          {reroll(spec.rerollHits, (v) => set("rerollHits", v))}
        </label>
        <label>
          Sustained{" "}
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
          Lethal hits
        </label>
        <label>
          Wound {target(spec.wound, (v) => set("wound", v ?? 6), "6+")}{" "}
          {mod(spec.woundMod, (v) => set("woundMod", v))}{" "}
          {reroll(spec.rerollWounds, (v) => set("rerollWounds", v))}
        </label>
        <label>Crit wound on {target(spec.critWound, (v) => set("critWound", v ?? 6), "6+")}</label>
        <label className="check">
          <input
            type="checkbox"
            checked={spec.devastating}
            onChange={(e) => set("devastating", e.target.checked)}
          />{" "}
          Devastating
        </label>
        <label>Save {target(spec.save, (v) => set("save", v), "none")}</label>
        <label>
          Damage <input value={spec.damage} onChange={(e) => set("damage", e.target.value)} size={6} />
        </label>
        <label>Feel no pain {target(spec.fnp, (v) => set("fnp", v), "none")}</label>
      </div>
      {s.inRange === 0 && spec.kind === "ranged" && (
        <p className="warn">Out of range{rangeOf(game, spec) ? ` (${rangeOf(game, spec)})` : ""}</p>
      )}
      {s.inRange === 0 && spec.kind === "ranged" ? (
        <button disabled title="No model has the target in range, so there are no attacks to roll">
          Declare attack
        </button>
      ) : s.inRange === 0 || s.visible === 0 ? (
        <button onClick={() => onDeclare(spec)} title="No models in range, or no target visible">
          Declare anyway
        </button>
      ) : (
        <button className="primary" onClick={() => onDeclare(spec)}>
          Declare attack
        </button>
      )}
    </div>
  );
}

/** The weapon's range as its profile prints it. */
function rangeOf(game: GameState, spec: AttackSpec): string | undefined {
  const chars = game.units[spec.attackerUnitId]?.sheet?.weapons[spec.weaponId]?.chars;
  return chars?.Range ?? chars?.range;
}

const STAGE_LABEL: Record<AttackState["stage"], string> = {
  hit: "Roll to hit",
  wound: "Roll to wound",
  save: "Roll saves",
  damage: "Roll damage",
  done: "",
};

function AttackInProgress({ attack, live }: { attack: AttackState; live: boolean }) {
  const game = useGame();
  const { dispatch, role } = useStore();
  const { spec } = attack;
  const attacker = game.units[spec.attackerUnitId];
  const target = game.units[spec.targetUnitId];
  const canAct = live && role !== "spectator";
  const remaining = useMemo(() => stagesLeft(attack), [attack]);
  // Saves are the defender's roll; everything else is the attacker's.
  const roller = attack.stage === "save" ? target?.owner : attacker?.owner;
  const roll = () => dispatch({ type: "attack/roll" }, roller);
  const rollAll = () => {
    for (let i = 0; i < remaining; i++) dispatch({ type: "attack/roll" }, roller);
  };

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {attacker?.name} → {target?.name}: {spec.weaponName}
        </strong>
      </div>
      <p className="muted">
        {attack.attackCount} attacks
        {attack.attackRolls.length ? ` (rolled ${attack.attackRolls.join(" ")})` : ""} · hit{" "}
        {spec.hit === null ? "auto" : `${spec.hit}+${fmtMod(spec.hitMod)}`} · wound {spec.wound}+
        {fmtMod(spec.woundMod)} · save {spec.save ? `${spec.save}+` : "none"} · D {spec.damage}
        {spec.fnp ? ` · FNP ${spec.fnp}+` : ""}
      </p>
      {attack.hitDice && (
        <Stage label="Hits" dice={attack.hitDice} judge={(v) => hitJudge(spec, v)}>
          {attack.hits} hits{attack.critHits ? `, ${attack.critHits} critical` : ""}
          {attack.autoWounds ? `, ${attack.autoWounds} auto-wound` : ""}
        </Stage>
      )}
      {spec.hit === null && attack.hits !== undefined && !attack.hitDice && (
        <p>Torrent: {attack.hits} automatic hits</p>
      )}
      {attack.woundDice && (
        <Stage label="Wounds" dice={attack.woundDice} judge={(v) => woundJudge(spec, v)}>
          {attack.wounds} wounds{attack.unsavable ? `, ${attack.unsavable} skip saves` : ""}
        </Stage>
      )}
      {attack.saveDice && (
        <Stage
          label="Saves"
          dice={attack.saveDice}
          judge={(v) => (spec.save !== null && v !== 1 && v >= spec.save ? "ok" : "fail")}
        >
          {attack.unsaved} unsaved
        </Stage>
      )}
      {attack.damage && <DamageSummary game={game} attack={attack} />}
      {live && target && (attack.stage === "save" || attack.stage === "damage") && !attack.damage && (
        <WoundOrder attack={attack} />
      )}
      {attacker && target && (
        <Reminders items={attackReminders(game, attacker.id, target.id, spec.kind)} live={live} />
      )}
      {canAct && (
        <div className="row">
          {attack.stage !== "done" && (
            <>
              <button className="primary" onClick={roll}>
                {STAGE_LABEL[attack.stage]}
              </button>
              <button onClick={rollAll}>Roll everything</button>
            </>
          )}
          <button onClick={() => dispatch({ type: "attack/clear" }, attacker?.owner)}>
            {attack.stage === "done" ? "Done" : "Cancel"}
          </button>
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

const fmtMod = (m: number) => (m > 0 ? ` (+${m})` : m < 0 ? ` (${m})` : "");

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
            title={d.rerolledFrom ? `re-rolled from ${d.rerolledFrom}` : undefined}
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
      <span className="label">Damage</span>
      <span className="dice">
        {results.map((d, i) => (
          <span
            key={i}
            className={`die ${d.destroyed ? "crit" : "ok"}`}
            title={game.models[d.modelId]?.label}
          >
            {d.damage}
          </span>
        ))}
      </span>
      <span className="result">
        <strong>
          {lost} wounds lost, {dead} model{dead === 1 ? "" : "s"} destroyed
        </strong>
        {attack.spec.fnp ? ` (${fnpSaved} ignored by feel no pain)` : ""}
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
      <span className="label">Wounds go to</span>
      <span className="chips" onMouseLeave={() => point(null)}>
        {groups.slice(0, 10).map((g, i) => {
          const m = g[0]!;
          const ids = g.map((x) => x.id);
          return (
            <button
              key={m.id}
              className={`chip ${i === 0 ? "on" : ""}`}
              disabled={!mine || i === 0}
              title={mine && i > 0 ? "Take wounds on these models first" : undefined}
              onMouseEnter={() => point(ids)}
              onFocus={() => point(ids)}
              onBlur={() => point(null)}
              onClick={() => toFront(ids)}
            >
              {i + 1}. {m.label}
              {gear(m)}
              {g.length > 1 ? ` ×${g.length}` : ""}
              {(m.woundsLost ?? 0) > 0 ? ` (${woundsLeft(m)} W left)` : ""}
            </button>
          );
        })}
        {groups.length > 10 && <span className="muted">+{groups.length - 10} more</span>}
      </span>
      <span className="result">
        {wounded > 0 ? (
          <span className="warn">A model that has already lost wounds should take the next one.</span>
        ) : mine && !chosen && groups.length > 1 ? (
          <span className="muted">Defender: click a model to put it first.</span>
        ) : null}
      </span>
    </div>
  );
}

function woundsLeft(m: { woundsLost?: number; profile?: { chars: Record<string, string> } }): number {
  const w = Number.parseInt(m.profile?.chars.W ?? "1", 10) || 1;
  return w - (m.woundsLost ?? 0);
}
