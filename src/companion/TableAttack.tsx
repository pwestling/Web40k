import { useState } from "react";
import { opposed } from "../core/teams";
import { t, tn } from "../i18n";
import { useStore, type AttackDraft } from "../store";
import { aliveModels, mainWeapon } from "../systems/wh40k/rules";
import { useGame } from "../ui/hooks";
import { SpecEditor } from "../ui/AttackPanel";
import { firstAnswers, tableAttack, weaponModels, aurasFor, type TableAnswers } from "./attack";
import { RollButton } from "./RealDice";

/**
 * Choosing an attack at a real table (#37): weapon and target, then what the
 * players see on their table (models in range, half range, sight, cover) in
 * place of what the board would measure.
 */
export function TableAttackSetup({ draft }: { draft: AttackDraft }) {
  const game = useGame();
  const setDraft = useStore((s) => s.setDraft);
  const attacker = game.units[draft.attackerId];
  const weaponId = draft.weaponId ?? (attacker ? mainWeapon(game, attacker, draft.kind) : undefined);
  const [answers, setAnswers] = useState<{ key: string; a: TableAnswers } | null>(null);
  if (!attacker) return null;
  const weapons = Object.values(attacker.sheet?.weapons ?? {})
    .filter((w) => w.kind === draft.kind)
    .map((w) => ({ ...w, count: weaponModels(game, attacker.id, w.id).length }))
    .filter((w) => w.count > 0)
    .sort((a, b) => b.count - a.count);
  const enemies = Object.values(game.units).filter(
    (u) => opposed(game, u.owner, attacker.owner) && aliveModels(game, u).length > 0 && !u.status?.reserves,
  );
  const key = `${weaponId}|${draft.targetId}`;
  const a = answers?.key === key ? answers.a : weaponId ? firstAnswers(game, attacker.id, weaponId) : null;
  const set = (patch: Partial<TableAnswers>) => a && setAnswers({ key, a: { ...a, ...patch } });
  const most = weaponId ? weaponModels(game, attacker.id, weaponId).length : 0;
  const suggestion =
    weaponId && draft.targetId && a ? tableAttack(game, attacker.id, weaponId, draft.targetId, a) : null;
  const ranged = draft.kind === "ranged";

  return (
    <div className="panel attack table-attack">
      <div className="row spread">
        <strong>
          {ranged ? t("{unit}: shoot", { unit: attacker.name }) : t("{unit}: fight", { unit: attacker.name })}
        </strong>
        <button onClick={() => setDraft(null)}>{t("Cancel")}</button>
      </div>
      <label>
        {t("Weapon")}{" "}
        <select
          value={weaponId ?? ""}
          onChange={(e) => setDraft({ ...draft, weaponId: e.target.value || undefined })}
        >
          <option value="">{t("Weapon…")}</option>
          {weapons.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} (×{w.count})
            </option>
          ))}
        </select>
      </label>
      <div className="targets" role="group" aria-label={t("Target")}>
        {enemies.map((u) => (
          <button
            key={u.id}
            className={u.id === draft.targetId ? "on" : ""}
            aria-pressed={u.id === draft.targetId}
            onClick={() => setDraft({ ...draft, targetId: u.id, picking: false })}
          >
            {u.name}
          </button>
        ))}
        {!enemies.length && <p className="muted">{t("No enemy units yet.")}</p>}
      </div>
      {a && draft.targetId && (
        <div className="answers">
          <p className="muted small">{t("On your table:")}</p>
          <div className="row stepper">
            <span>{ranged ? t("Models in range") : t("Models fighting")}</span>
            <button
              aria-label={t("Fewer")}
              disabled={a.inRange <= 0}
              onClick={() => set({ inRange: a.inRange - 1 })}
            >
              −
            </button>
            <strong>{t("{n} of {all}", { n: a.inRange, all: most })}</strong>
            <button
              aria-label={t("More")}
              disabled={a.inRange >= most}
              onClick={() => set({ inRange: a.inRange + 1 })}
            >
              +
            </button>
          </div>
          {ranged && (
            <>
              <Toggle on={a.half} set={(half) => set({ half })}>
                {t("Within half range")}
              </Toggle>
              <Toggle on={a.visible} set={(visible) => set({ visible })}>
                {t("Target visible")}
              </Toggle>
              <Toggle on={a.cover} set={(cover) => set({ cover })}>
                {t("Target in cover")}
              </Toggle>
            </>
          )}
          {aurasFor(game, attacker.id, draft.targetId).map((q) => (
            <Toggle
              key={q.key}
              on={!!a.auras?.includes(q.key)}
              set={(on) =>
                set({ auras: on ? [...(a.auras ?? []), q.key] : (a.auras ?? []).filter((k) => k !== q.key) })
              }
            >
              {t('{receiver} within {range}" of {source} ({ability})', {
                receiver: q.receiver.name,
                range: q.range,
                source: q.source.name,
                ability: q.ability.name,
              })}
            </Toggle>
          ))}
        </div>
      )}
      {suggestion && (
        <SpecEditor
          key={`${key}|${JSON.stringify(a)}`}
          suggestion={suggestion}
          onDeclare={() => {}}
          declare={(spec) => (
            <>
              {(a?.inRange === 0 || (ranged && !a?.visible)) && (
                <p className="warn">
                  {a?.inRange === 0 ? t("No models in range.") : t("The target can't be seen.")}
                </p>
              )}
              <RollButton
                className={a?.inRange && (!ranged || a.visible) ? "primary attack-declare" : "attack-declare"}
                intent={{ type: "attack/declare", spec }}
                as={attacker.owner}
                onRolled={() => setDraft(null)}
              >
                {t("Declare attack")}
              </RollButton>
              <span className="muted small">
                {tn(suggestion.inRange, "{n} model attacking", "{n} models attacking")}
              </span>
            </>
          )}
        />
      )}
    </div>
  );
}

function Toggle({ on, set, children }: { on: boolean; set: (on: boolean) => void; children: string }) {
  return (
    <div className="row toggle">
      <span>{children}</span>
      <button className={on ? "on" : ""} aria-pressed={on} onClick={() => set(true)}>
        {t("Yes")}
      </button>
      <button className={on ? "" : "on"} aria-pressed={!on} onClick={() => set(false)}>
        {t("No")}
      </button>
    </div>
  );
}
