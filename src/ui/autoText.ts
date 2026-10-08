import type { AbilityAuto, AttackBecause, AttackSpec, AutoPart, GameState } from "../core";
import type { GameSystem } from "../core/content/schema";
import { schedule } from "../core/content/turn";
import { t, tn } from "../i18n";

/** Automated abilities (#38) in the reader's language: the rule, and what went off at a phase change. */

const roll = (r: "hit" | "wound" | "save" | "damage") =>
  r === "hit" ? t("hit") : r === "wound" ? t("wound") : r === "save" ? t("save") : t("damage");

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
        : p.roll === "damage"
          ? t("−1 Damage (not below 1)")
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

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

/** What one rule did to the roll, in the reader's language: "−1 to hit", "re-roll 1s". */
export function changeText(b: AttackBecause): string {
  const c = b.change;
  const step =
    b.step === "hit"
      ? t("hit")
      : b.step === "wound"
        ? t("wound")
        : b.step === "save"
          ? t("save")
          : b.step === "damage"
            ? t("damage")
            : b.step;
  const parts: string[] = [];
  if (c.mod) parts.push(t("{by} to {roll}", { by: signed(c.mod), roll: step }));
  if (c.target) parts.push(t("{roll} target {by}", { by: signed(c.target), roll: step }));
  if (c.reroll === "ones") parts.push(t("re-roll 1s"));
  else if (c.reroll) parts.push(t("re-roll fails"));
  if (c.crit) parts.push(t("criticals on {n}+", { n: c.crit }));
  return parts.join(", ");
}

/**
 * What to roll on one step, first, then why it isn't the printed number:
 * "5+ (6+, +1 Fused Plates)" (UX 296, 302). Modifiers count up to ±1; a hit or
 * wound always needs at least a 2 and at most a 6.
 */
export function stepValue(
  spec: AttackSpec,
  step: "hit" | "wound" | "save",
  base: number,
  net: number,
): string {
  const capped = Math.max(-1, Math.min(1, net));
  const need = step === "save" ? Math.max(2, base - capped) : Math.max(2, Math.min(6, base - capped));
  const named = (spec.because ?? [])
    .filter((b) => b.step === step && b.change.mod)
    .map((b) => `${signed(b.change.mod!)} ${b.name}`);
  if (!net && !named.length) return `${base}+`;
  return `${need}+ (${base}+, ${named.length ? named.join(", ") : signed(net)})`;
}

/** A damage roll with a flat change: "D6" with +1 is "D6+1". */
export function shiftDamage(amount: string, by: number): string {
  const m = /^(.*?)([+-]\d+)?$/.exec(amount.trim());
  const dice = m?.[1] ?? amount;
  const flat = Number(m?.[2] ?? 0) + by;
  if (/^\d*$/.test(dice)) return String(Math.max(0, Number(dice || 0) + flat));
  return flat ? `${dice}${flat > 0 ? "+" : "−"}${Math.abs(flat)}` : dice;
}

/** Damage to roll first, then the profile's own and the changes: "D6 (D6+1, −1 Armoured Hull; re-roll 1s)". */
export function damageValue(spec: AttackSpec): string {
  const changes = (spec.because ?? []).filter((b) => b.step === "damage" && b.change.mod);
  const net = changes.reduce((t, b) => t + b.change.mod!, 0);
  const why = [
    ...(net
      ? [
          [shiftDamage(spec.damage, -net), ...changes.map((b) => `${signed(b.change.mod!)} ${b.name}`)].join(
            ", ",
          ),
        ]
      : []),
    ...(spec.rerollDamage === "ones"
      ? [t("re-roll 1s")]
      : spec.rerollDamage && spec.rerollDamage !== "none"
        ? [t("re-roll")]
        : []),
  ];
  return why.length ? `${spec.damage} (${why.join("; ")})` : spec.damage;
}

/** "Smouldering Ward −1 to hit, Braced Firing re-roll 1s", for the log line. */
export function becauseText(spec: AttackSpec): string {
  return (spec.because ?? [])
    .map((b) => {
      const what = changeText(b);
      return what ? `${b.name} ${what}` : "";
    })
    .filter(Boolean)
    .join(", ");
}
