import type { AbilityAuto, AutoPart, GameState } from "../core";
import type { GameSystem } from "../core/content/schema";
import { schedule } from "../core/content/turn";
import { t, tn } from "../i18n";

/** Automated abilities (#38) in the reader's language: the rule, and what went off at a phase change. */

const roll = (r: "hit" | "wound") => (r === "hit" ? t("hit") : t("wound"));

function attackText(p: Extract<AutoPart, { kind: "attack" }>): string {
  const who =
    p.side === "making"
      ? p.weapon === "ranged"
        ? t("Its ranged attacks")
        : p.weapon === "melee"
          ? t("Its melee attacks")
          : t("Its attacks")
      : p.weapon === "ranged"
        ? t("Ranged attacks against it")
        : p.weapon === "melee"
          ? t("Melee attacks against it")
          : t("Attacks against it");
  const what = p.grant
    ? t("gain {rule}", { rule: p.grant.replace(/\b\w/g, (c) => c.toUpperCase()) })
    : p.reroll === "ones"
      ? t("re-roll {roll} rolls of 1", { roll: roll(p.roll!) })
      : p.reroll
        ? t("re-roll failed {roll} rolls", { roll: roll(p.roll!) })
        : (p.by ?? 0) > 0
          ? t("+1 to {roll}", { roll: roll(p.roll!) })
          : t("−1 to {roll}", { roll: roll(p.roll!) });
  const conds = [
    ...(p.against ? [t("against {keywords}", { keywords: p.against.join(t(" or ")) })] : []),
    ...(p.when === "charged" ? [t("after charging")] : []),
    ...(p.when === "stationary" ? [t("if it stayed still")] : []),
  ];
  return `${who}: ${what}${conds.length ? `, ${conds.join(", ")}` : ""}`;
}

function partText(p: AutoPart): string {
  switch (p.kind) {
    case "attack":
      return attackText(p);
    case "fnp":
      // Rule names stay in English, as army lists use them.
      return `Feel No Pain ${p.x}+`;
    case "gain":
      return t("gain {amount} {resource}", { amount: p.amount, resource: p.resource });
    case "heal":
      return t("its most hurt model regains up to {amount} wounds", { amount: p.amount });
  }
}

/** The rule in a sentence or two, e.g. "While leading: Its attacks: re-roll hit rolls of 1." */
export function describeAuto(auto: AbilityAuto, system: GameSystem): string {
  const body = auto.parts.map(partText).join("; ");
  const scope: string[] = [];
  if (auto.whileLeading) scope.push(t("While leading a unit"));
  if (auto.aura)
    scope.push(
      auto.aura.side === "enemy"
        ? t('Enemy {keyword}units within {range}"', {
            keyword: auto.aura.keyword ? `${auto.aura.keyword} ` : "",
            range: auto.aura.range,
          })
        : t('Friendly {keyword}units within {range}"', {
            keyword: auto.aura.keyword ? `${auto.aura.keyword} ` : "",
            range: auto.aura.range,
          }),
    );
  if (auto.oncePerBattle) scope.push(t("Once per battle, for one phase"));
  if (auto.trigger) {
    const phase = schedule(system).find((s) => s.id === auto.trigger!.phase)?.name ?? auto.trigger.phase;
    const turn = auto.trigger.anyTurn ? t("each") : t("your");
    scope.push(
      auto.trigger.at === "end"
        ? t("At the end of {turn} {phase} phase", { turn, phase })
        : t("At the start of {turn} {phase} phase", { turn, phase }),
    );
  }
  return scope.length ? `${scope.join(", ")}: ${body}` : body;
}

/** Log lines for abilities that went off as the phase changed. */
export function triggeredLines(state: GameState): string[] {
  return (state.triggered ?? []).map((tr) => {
    const unit = state.units[tr.unitId]?.name ?? "";
    if (tr.gained)
      return t("{unit}'s {ability}: +{amount} {resource}", {
        unit,
        ability: tr.ability,
        amount: tr.gained.amount,
        resource: tr.gained.resource,
      });
    const wounds = tr.healed?.wounds ?? 0;
    return tr.healed?.roll !== undefined
      ? tn(
          wounds,
          "{unit}'s {ability}: rolled {roll}, {n} wound regained",
          "{unit}'s {ability}: rolled {roll}, {n} wounds regained",
          {
            unit,
            ability: tr.ability,
            roll: tr.healed.roll,
          },
        )
      : tn(wounds, "{unit}'s {ability}: {n} wound regained", "{unit}'s {ability}: {n} wounds regained", {
          unit,
          ability: tr.ability,
        });
  });
}
