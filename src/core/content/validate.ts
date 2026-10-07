import type { ContentPack, GameSystem, RuleRef, Segment } from "./schema";

/**
 * Cross-reference checks for a GameSystem and the packs loaded on top of it:
 * every action, procedure, rule, status, resource, table, arc and plan that
 * something refers to must exist. Returns problems rather than throwing, so
 * the UI can show them when a player imports a pack.
 */
export function validateSystem(system: GameSystem, packs: ContentPack[] = []): string[] {
  const problems: string[] = [];
  const ids = (xs: { id: string }[] | undefined) => new Set((xs ?? []).map((x) => x.id));
  const rules = ids([...system.rules, ...packs.flatMap((p) => p.rules ?? [])]);
  const actions = ids([...system.actions, ...packs.flatMap((p) => p.actions ?? [])]);
  const procedures = ids(system.procedures);
  const statuses = ids(system.statuses);
  const resources = ids(system.resources);
  const tables = ids(system.tables);
  const arcs = ids(system.arcs);
  const characteristics = ids(system.characteristics);
  const plans = new Set<string>();

  const need = (set: Set<string>, id: string, what: string, where: string) => {
    if (!set.has(id)) problems.push(`${where}: unknown ${what} "${id}"`);
  };

  const walkSegments = (segments: Segment[], where: string) => {
    for (const seg of segments) {
      switch (seg.kind) {
        case "phase":
          for (const a of seg.actions ?? []) need(actions, a, "action", `${where}/${seg.id}`);
          walkSegments(seg.segments ?? [], `${where}/${seg.id}`);
          break;
        case "playerTurns":
          walkSegments(seg.segments, where);
          break;
        case "alternate":
          if (seg.pool.kind === "planned") need(plans, seg.pool.plan, "plan", `${where}/${seg.id}`);
          if (seg.pool.kind === "resource")
            need(resources, seg.pool.resource, "resource", `${where}/${seg.id}`);
          walkSegments(seg.activation, `${where}/${seg.id}`);
          break;
        case "plan":
          plans.add(seg.id);
          break;
        case "step":
          break;
      }
    }
  };
  walkSegments(system.turn.round, "turn");

  for (const action of [...system.actions, ...packs.flatMap((p) => p.actions ?? [])]) {
    if (action.procedure) need(procedures, action.procedure, "procedure", `action ${action.id}`);
    for (const c of action.cost ?? []) need(resources, c.resource, "resource", `action ${action.id}`);
  }

  // Generic references buried in expressions and effects.
  const scan = (node: unknown, where: string) => {
    if (Array.isArray(node)) return node.forEach((n) => scan(n, where));
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.hasStatus === "string" && typeof o.status === "string")
      need(statuses, o.status, "status", where);
    if ((o.do === "applyStatus" || o.do === "removeStatus") && typeof o.status === "string")
      need(statuses, o.status, "status", where);
    if ((o.do === "gainResource" || o.do === "spendResource") && typeof o.resource === "string")
      need(resources, o.resource, "resource", where);
    if (o.do === "run" && typeof o.action === "string") need(actions, o.action, "action", where);
    if (o.do === "grantRule" && o.rule && typeof o.rule === "object") checkRuleRef(o.rule as RuleRef, where);
    if (typeof o.table === "string" && "row" in o) need(tables, o.table, "table", where);
    if (o.kind === "inArc" && typeof o.arc === "string") need(arcs, o.arc, "arc", where);
    for (const v of Object.values(o)) scan(v, where);
  };
  const checkRuleRef = (r: RuleRef, where: string) => need(rules, r.rule, "rule", where);

  scan(system.rules, "rules");
  scan(system.procedures, "procedures");
  scan(system.actions, "actions");
  scan(system.statuses, "statuses");
  scan(system.checks, "checks");
  scan(system.coreEffects, "coreEffects");
  scan(system.turn, "turn");

  for (const pack of packs) {
    if (pack.system !== system.id) problems.push(`pack ${pack.id}: made for system "${pack.system}"`);
    scan(pack.rules, `pack ${pack.id} rules`);
    scan(pack.actions, `pack ${pack.id} actions`);
    for (const unit of Object.values(pack.units)) {
      for (const r of unit.rules) checkRuleRef(r, `unit ${unit.id}`);
      for (const m of unit.models)
        if (!pack.models[m.model]) problems.push(`unit ${unit.id}: unknown model "${m.model}"`);
    }
    for (const model of Object.values(pack.models)) {
      for (const c of Object.keys(model.characteristics))
        need(characteristics, c, "characteristic", `model ${model.id}`);
      for (const w of model.weapons)
        if (!pack.weapons[w]) problems.push(`model ${model.id}: unknown weapon "${w}"`);
      for (const r of model.rules ?? []) checkRuleRef(r, `model ${model.id}`);
    }
    for (const weapon of Object.values(pack.weapons)) {
      if (!system.weaponKinds.includes(weapon.kind))
        problems.push(`weapon ${weapon.id}: unknown kind "${weapon.kind}"`);
      for (const c of Object.keys(weapon.characteristics))
        need(characteristics, c, "characteristic", `weapon ${weapon.id}`);
      for (const r of weapon.rules) checkRuleRef(r, `weapon ${weapon.id}`);
    }
  }
  return problems;
}
