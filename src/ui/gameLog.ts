import {
  applyEvent,
  phaseName,
  rulerLength,
  systemOf,
  undoneSeqs,
  type AttackState,
  type GameRecord,
  type GameState,
  type LoggedEvent,
} from "../core";

/** A line of the game log as players read it. */
export type LogItem =
  | { kind: "header"; key: string; text: string }
  | { kind: "line"; key: string; seq: number; text: string; undone: boolean };

/**
 * The event log in words: phase changes become headers, each attack is one
 * line however many rolls it took, and moves say which unit went how far.
 * Folds the record once, so every line can compare the table before and after.
 */
export function buildLog(record: GameRecord, uptoSeq = Infinity): LogItem[] {
  const undone = undoneSeqs(record, uptoSeq);
  const items: LogItem[] = [];
  let state = record.initial;
  let attackLine: Extract<LogItem, { kind: "line" }> | null = null;
  // A system procedure (any game's attack) is one line, updated as it is rolled.
  let procLine: Extract<LogItem, { kind: "line" }> | null = null;
  // Deployment: one line per player and army, however many units it had.
  let deployLine:
    (Extract<LogItem, { kind: "line" }> & { by: string; army?: string; units: number; pts: number }) | null =
    null;
  for (const logged of record.events) {
    if (logged.seq > uptoSeq) break;
    const skipped = undone.has(logged.seq);
    const before = state;
    if (!skipped) state = applyEvent(state, logged.event);
    state = { ...state, seq: logged.seq };
    const { event } = logged;
    const key = String(logged.seq);
    if (
      !skipped &&
      (event.type === "turn/next" || event.type === "turn/prev" || event.type === "turn/first")
    ) {
      items.push({ kind: "header", key, text: turnHeader(state) });
      continue;
    }
    if (event.type === "unit/add" && !skipped) {
      const army = event.unit.army;
      const pts = event.unit.sheet?.points ?? 0;
      if (deployLine && deployLine.by === logged.by && deployLine.army === army) {
        deployLine.units++;
        deployLine.pts += pts;
      } else {
        deployLine = {
          kind: "line",
          key,
          seq: logged.seq,
          text: "",
          undone: false,
          by: logged.by,
          army,
          units: 1,
          pts,
        };
        items.push(deployLine);
      }
      const who = state.players[logged.by]?.name ?? "Someone";
      const { units, pts: total } = deployLine;
      const size = `${units} unit${units === 1 ? "" : "s"}${total ? `, ${total} pts` : ""}`;
      deployLine.text =
        units === 1 && !army
          ? `${who} deployed ${event.unit.name}`
          : `${who} deployed ${army ?? "an army"} (${size})`;
      continue;
    }
    deployLine = null;
    if (event.type === "attack/declare" || event.type === "attack/roll") {
      const text = attackSummary(state.attack ?? event.attack, state);
      if (attackLine && event.type === "attack/roll") attackLine.text = text;
      else {
        attackLine = { kind: "line", key, seq: logged.seq, text, undone: skipped };
        items.push(attackLine);
      }
      continue;
    }
    if (event.type === "procedure/set" || (event.type === "procedure/clear" && procLine)) {
      if (event.type === "procedure/clear") {
        procLine = null;
        continue;
      }
      const text = procedureSummary(state);
      if (procLine) procLine.text = text;
      else items.push((procLine = { kind: "line", key, seq: logged.seq, text, undone: skipped }));
      continue;
    }
    if ((event.type === "action/take" || event.type === "reaction/end") && !skipped && state.procedure) {
      // The action and its first rolls; later rolls update the same line.
      const lead = describe(logged, before, state);
      procLine = {
        kind: "line",
        key,
        seq: logged.seq,
        text: `${lead}. ${procedureSummary(state)}`,
        undone: skipped,
      };
      items.push(procLine);
      continue;
    }
    if (event.type === "attack/clear") {
      // Folded into the attack's own line.
      if (attackLine) {
        attackLine = null;
        continue;
      }
    }
    const text = describe(logged, before, state);
    // Bookkeeping events (an empty description) stay out of the log.
    if (text) items.push({ kind: "line", key, seq: logged.seq, text, undone: skipped });
  }
  return items;
}

function turnHeader(state: GameState): string {
  const { round, activeSeat } = state.turn;
  if (round === 0) return "Deployment";
  const player =
    Object.values(state.players).find((p) => p.seat === activeSeat)?.name ?? `Player ${activeSeat + 1}`;
  return `Round ${round} · ${player} · ${phaseName(state) ?? ""}`;
}

/** "Line Troopers shot Ashen Thralls (Pattern Rifle): 16 attacks, 11 hits, 6 wounds, 2 unsaved, 2 slain". */
function attackSummary(a: AttackState, state: GameState): string {
  const s = a.spec;
  const name = (id: string) => state.units[id]?.name ?? "a unit";
  const parts = [`${a.attackCount} attacks`];
  if (a.hits !== undefined) parts.push(`${a.hits} hits`);
  if (a.wounds !== undefined) parts.push(`${a.wounds} wounds`);
  if (a.unsaved !== undefined) parts.push(`${a.unsaved} unsaved`);
  if (a.damage) {
    const slain = a.damage.filter((d) => d.destroyed).length;
    const lost = a.damage.reduce((n, d) => n + d.lost, 0);
    parts.push(slain ? `${slain} slain` : `${lost} wounds lost`);
  }
  const verb = s.kind === "melee" ? "fought" : "shot";
  return `${name(s.attackerUnitId)} ${verb} ${name(s.targetUnitId)} (${s.weaponName}): ${parts.join(", ")}`;
}

/** "Raider Gang Carbines at Lancer Tank: hit 1/3, save 1/1, 0 bases lost". */
function procedureSummary(state: GameState): string {
  const proc = state.procedure;
  if (!proc) return "";
  const parts = proc.run.records
    .filter((r) => r.dice?.length)
    .map((r) => `${r.id} ${r.successes ?? 0}/${r.in}`);
  if (proc.run.done) {
    const lost = proc.run.outcomes.filter((o) => o.kind === "wounds").length;
    const destroyed = proc.run.outcomes.some((o) => o.kind === "destroy");
    parts.push(destroyed ? "destroyed" : `${lost} lost`);
  }
  return `${proc.title}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/** How far the furthest model moved, counting climbs. */
function moveText(before: GameState, after: GameState, ids: string[]): string {
  let far = 0;
  let unitId: string | undefined;
  for (const id of ids) {
    const a = before.models[id];
    const b = after.models[id];
    if (!a || !b) continue;
    unitId ??= a.unitId;
    // Measured as the unit card measures moves: across the table plus any climb.
    const d =
      Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y) +
      Math.abs((b.z ?? 0) - (a.z ?? 0));
    far = Math.max(far, d);
  }
  const unit = unitId ? after.units[unitId] : undefined;
  const whole = unit && ids.length >= unit.modelIds.length;
  const what = unit
    ? whole
      ? unit.name
      : `${ids.length === 1 ? "a model of" : `${ids.length} models of`} ${unit.name}`
    : "models";
  return far < 0.05 ? `turned ${what}` : `moved ${what} ${far.toFixed(1)}"`;
}

export function describe({ by, event }: LoggedEvent, before: GameState, game: GameState): string {
  const nameOf = (id: string) => game.players[id]?.name ?? "Someone";
  const who = nameOf(by);
  const unitName = (id: string) => game.units[id]?.name ?? "a unit";
  switch (event.type) {
    case "player/join":
      return `${game.players[event.player.id]?.name ?? event.player.name} joined`;
    case "player/claim":
      return `${nameOf(event.by)} reconnected`;
    case "dice/roll": {
      const { results, label, unitId, sides, faces } = event.roll;
      const total = results.reduce((a, b) => a + b, 0);
      const what = label ? `${unitId ? `${unitName(unitId)} ` : ""}${label}` : `${results.length}D${sides}`;
      if (faces) return `${who} rolled ${what}: ${results.map((r) => faces[r - 1] ?? r).join(" ")}`;
      return `${who} rolled ${what}: ${results.join(" ")}${results.length > 1 ? ` (= ${total})` : ""}`;
    }
    case "undo":
      return `${who} took back an action`;
    case "unit/add":
      return `${who} deployed ${event.unit.name} (${event.models.length})`;
    case "terrain/add":
      return `${who} added ${event.piece.name.toLowerCase()}`;
    case "terrain/update":
      return `${who} changed ${event.piece.name.toLowerCase()}`;
    case "terrain/remove":
      return `${who} removed terrain`;
    case "player/ready":
      return `${game.players[event.player]?.name ?? who} is ${event.ready ? "ready" : "not ready yet"}`;
    case "game/packages": {
      const was = before.packages;
      const names = (ps: { name: string; version: string }[]) =>
        ps.map((p) => `${p.name} ${p.version}`).join(", ");
      if (event.agreed && was) {
        const changes = describePackageChange(was.packages, event.packages);
        return `Rules changed: ${changes || "packages updated"} (${event.agreed.length === 2 ? "both players agreed" : event.agreed.length > 2 ? "all players agreed" : "agreed"})`;
      }
      return event.packages.length
        ? `Rules packages: ${names(event.packages)}`
        : "Rules packages: none (built-in rules only)";
    }
    case "packages/propose":
      return `${who} proposed changing the rules: ${describePackageChange(game.packages?.packages ?? [], event.packages) || "no change"}`;
    case "packages/accept":
      return `${game.players[event.player]?.name ?? who} accepted the rules change`;
    case "packages/decline":
      return `${game.players[event.player]?.name ?? who} declined the rules change`;
    case "packages/withdraw":
      return `${who} withdrew the rules change`;
    case "player/resync":
      return `${game.players[event.player]?.name ?? who} resynced from the host`;
    case "player/rules": {
      const names = (game.packages?.packages ?? []).filter((p) => event.missing.includes(p.hash));
      const name = game.players[event.player]?.name ?? who;
      return event.missing.length
        ? `${name} is playing without ${names.map((p) => `${p.name} ${p.version}`).join(", ") || "some of the rules"}: their table may disagree`
        : `${name} now has the game's rules`;
    }
    case "template/set": {
      const t = event.template;
      const old = before.templates?.[event.id];
      const name = (t?.label ?? old?.label ?? "template").toLowerCase();
      return t ? `${who} ${old ? "moved" : "placed"} the ${name}` : `${who} removed the ${name}`;
    }
    case "template/scatter": {
      const t = before.templates?.[event.id];
      const name = (event.label ?? t?.label ?? "template").toLowerCase();
      if (event.scatter.toLowerCase() === "hit") return `${who} rolled a hit: the ${name} stays put`;
      const inches = Number(event.distance);
      if (!inches) return `${who} rolled ${event.distance} for the ${name}: it doesn't move`;
      const { width, depth } = game.table;
      const off = Math.abs(event.to.x) > width / 2 || Math.abs(event.to.y) > depth / 2;
      return `${who} scattered the ${name} ${inches}" towards the ${bearing(event.angle)}${off ? ", off the table" : ""}`;
    }
    case "ruler/set": {
      const r = event.ruler;
      if (!r) return `${who} cleared the ruler`;
      const name = (id?: string) => (id ? (game.models[id]?.label ?? "a model") : "a point");
      const ends = r.fromModel || r.toModel ? ` (${name(r.fromModel)} to ${name(r.toModel)})` : "";
      return `${who} measured ${rulerLength(game, r).toFixed(1)}"${ends}`;
    }
    case "objective/move":
      return `${who} moved an objective`;
    case "unit/figure":
      return event.figure
        ? `${who} gave ${unitName(event.id)} the figure ${event.figure.name}`
        : `${who} took the figure off ${unitName(event.id)}`;
    case "unit/height":
      return `${who} set ${unitName(event.id)} height to ${event.height ?? "default"}"`;
    case "settings/set": {
      const st = event.settings;
      const parts = [
        st.cover && `cover ${st.cover === "hit" ? "−1 to hit" : "+1 to save"}`,
        st.los &&
          `line of sight: ${st.los === "heights" ? "stand-in heights" : st.los === "footprint" ? "footprints" : "true"}`,
        st.visionArc !== undefined && `vision ${st.visionArc >= 360 ? "all around" : `${st.visionArc}° arc`}`,
        st.modelsBlock !== undefined && `models ${st.modelsBlock ? "block" : "don't block"} sight`,
      ].filter(Boolean);
      return `${who} set ${parts.join(", ") || "game settings"}`;
    }
    case "unit/attach":
      return `${who} attached ${unitName(event.id)} to ${unitName(event.to)}`;
    case "unit/remove":
      return `${who} removed ${unitName(event.id)}`;
    case "unit/move": {
      const name = unitName(event.id);
      const deg = Math.round((Math.abs(event.turn) * 180) / Math.PI);
      if (event.how === "wheel")
        return `${who} wheeled ${name} ${deg}° ${event.turn < 0 ? "right" : "left"} (${(event.distance ?? 0).toFixed(1)}")`;
      const inches = `${(event.distance ?? 0).toFixed(1)}"`;
      if (event.how === "door") return `${who} closed the door: ${name} lined up with its target (${inches})`;
      if (event.how === "charge") return `${name} charged ${inches}`;
      if (event.how === "flee") return `${name} fled ${inches}`;
      if (event.how === "pursue") return `${name} pursued ${inches}`;
      if (event.how === "forward")
        return `${who} moved ${name} ${(event.distance ?? 0) < 0 ? "back" : "forward"} ${Math.abs(event.distance ?? 0).toFixed(1)}"`;
      return `${who} ${moveText(before, game, game.units[event.id]?.modelIds ?? [])}`;
    }
    case "unit/form": {
      const name = unitName(event.id);
      const f = event.formation;
      const cost = event.distance ? ` (${Number(event.distance.toFixed(1))}")` : "";
      if (event.how === "order")
        return f.kind === "ranked"
          ? `${who} put ${name} in ${f.order ?? "close"} order`
          : `${who} sent ${name} out as skirmishers`;
      if (event.how === "turn") {
        const id = game.units[event.id]?.modelIds[0] ?? "";
        const from = before.models[id]?.facing ?? 0;
        const to = game.models[id]?.facing ?? from;
        const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
        const way = Math.abs(Math.abs(d) - Math.PI) < 0.1 ? "about" : d > 0 ? "left" : "right";
        return `${who} turned ${name} ${way}${cost}`;
      }
      const wide = f.kind === "ranked" ? ` ${f.files} wide` : "";
      return `${who} ${event.how === "redress" ? "redressed" : "reformed"} ${name}${wide}${cost}`;
    }
    case "model/move":
      return `${who} ${moveText(before, game, [event.id])}`;
    case "models/move":
      if (event.snap !== undefined) {
        const unitId = game.models[event.moves[0]?.id ?? ""]?.unitId;
        return `${unitName(unitId ?? "")} snapped back to ${event.snap}"`;
      }
      return `${who} ${moveText(
        before,
        game,
        event.moves.map((m) => m.id),
      )}`;
    case "unit/status":
      if (event.key === "marching")
        return event.value ? `${unitName(event.id)} is marching` : `${unitName(event.id)} stopped marching`;
      if (event.key === "disrupted")
        return event.value
          ? `${unitName(event.id)} is disrupted`
          : `${unitName(event.id)} is no longer disrupted`;
      if (event.key === "fleeing")
        return event.value ? `${unitName(event.id)} is fleeing` : `${unitName(event.id)} rallied`;
      if (event.key === "lastFiles") return "";
      return `${who} set ${unitName(event.id)} ${event.key} = ${event.value ?? "off"}`;
    case "model/wounds":
      return `${who} set wounds on ${game.models[event.id]?.label ?? "a model"}${event.destroyed ? " (destroyed)" : ""}`;
    case "layout/set":
      return "Table set up";
    case "resource/adjust":
      return `${nameOf(event.player)} ${event.delta > 0 ? "+" : ""}${event.delta} ${event.resource}`;
    case "attack/clear":
      return "Attack cancelled";
    case "action/take": {
      const weapon = event.weapon ? game.units[event.unitId]?.sheet?.weapons[event.weapon]?.name : undefined;
      const action = systemOf(game).actions.find((a) => a.id === event.action)?.name ?? event.action;
      const also = event.with?.length ? ` with ${event.with.map(unitName).join(", ")}` : "";
      const target = event.targetId ? ` at ${unitName(event.targetId)}` : "";
      return `${unitName(event.unitId)}: ${action}${weapon ? ` (${weapon})` : ""}${target}${also}${event.hold ? ", waiting on a reaction" : ""}`;
    }
    case "reaction/end":
      return "Reaction over";
    case "procedure/clear":
      return "Roll closed";
    case "turn/pass":
      return `${who} passed`;
    case "turn/endActivation":
      return `${who} ended the activation`;
    case "pool/set":
      return `${nameOf(event.player)} re-rolled or spent dice`;
    case "game/system":
      return `Game: ${systemOf(game).name}`;
    case "player/action": {
      const name =
        event.label ?? systemOf(game).actions.find((a) => a.id === event.action)?.name ?? event.action;
      const spent = event.payment
        .map((p) => `${p.amount ?? p.indices?.length ?? 0} ${p.resource}`)
        .join(", ");
      const on = event.targetId ? ` on ${unitName(event.targetId)}` : "";
      return `${nameOf(event.player)} used ${name}${on}${spent ? ` (${spent})` : ""}`;
    }
    case "ability/apply":
      return `${unitName(event.unitId)}: ${event.ability} applied`;
    case "unit/reserve":
      return event.reserve
        ? `${unitName(event.id)} went into reserves`
        : `${unitName(event.id)} arrives from reserves`;
    case "unit/specialMove":
      return `${unitName(event.id)} may move up to ${event.inches}" (${event.flag})`;
    case "attack/allocate":
      return `${who} chose the order their models take wounds`;
    case "script/step": {
      // A code procedure's effects, each described as if logged on its own.
      const parts = event.events.map((e) => describe({ by, event: e, seq: 0, at: 0 }, before, game));
      if (event.error) parts.push(`stopped: ${event.error}`);
      if (event.script?.waiting)
        parts.push(`${nameOf(event.script.waiting.player)} to choose: ${event.script.waiting.question}`);
      return parts.join(" · ") || `${who} continued ${event.script?.procedure ?? "a rule"}`;
    }
    case "module/set":
      return `${who}: ${event.key} updated`;
    default:
      return `${who}: ${(event as { type: string }).type}`;
  }
}

/**
 * The log for reading: phases nothing happened in fold away. A whole player
 * turn with no actions becomes one "Round 1 · Player 2: no actions" line, and
 * empty phases before one with actions are dropped. The replay track keeps
 * using the full log.
 */
export function collapseEmpty(log: LogItem[]): LogItem[] {
  const out: LogItem[] = [];
  const turnOf = (text: string) => /^(Round \d+ · [^·]+?) · /.exec(text)?.[1] ?? text;
  let run: Extract<LogItem, { kind: "header" }>[] = [];
  // The turn of the last header shown: its later empty phases just drop.
  let shownTurn = "";
  const flush = () => {
    if (!run.length) return;
    const last = run.at(-1)!;
    const lastTurn = turnOf(last.text);
    let i = 0;
    while (i < run.length) {
      const turn = turnOf(run[i]!.text);
      let j = i;
      while (j + 1 < run.length && turnOf(run[j + 1]!.text) === turn) j++;
      if (turn !== lastTurn && turn !== shownTurn)
        out.push({ kind: "header", key: run[i]!.key, text: `${turn}: no actions` });
      i = j + 1;
    }
    out.push(last);
    shownTurn = lastTurn;
    run = [];
  };
  for (const item of log) {
    if (item.kind === "header") run.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

/**
 * A scatter direction as seen on screen from the default view: seat 0's edge
 * (+y) is at the bottom, +x to the right.
 */
export function bearing(facing: number): string {
  const dx = Math.sin(facing);
  const dy = Math.cos(facing);
  const names = ["right", "bottom-right", "bottom", "bottom-left", "left", "top-left", "top", "top-right"];
  const a = Math.atan2(dy, dx); // 0 = right, pi/2 = down the screen (+y)
  const i = Math.round(a / (Math.PI / 4));
  return names[((i % 8) + 8) % 8]!;
}

/** "Old World Factions 1.2 → 1.3, + Overwatch macros 0.1, − Old House Rules 2.0". */
export function describePackageChange(
  from: { id: string; name: string; version: string; hash: string }[],
  to: { id: string; name: string; version: string; hash: string }[],
): string {
  const parts: string[] = [];
  for (const p of to) {
    const old = from.find((o) => o.id === p.id);
    if (!old) parts.push(`+ ${p.name} ${p.version}`);
    else if (old.hash !== p.hash) parts.push(`${p.name} ${old.version} → ${p.version}`);
  }
  for (const o of from) if (!to.some((p) => p.id === o.id)) parts.push(`− ${o.name} ${o.version}`);
  return parts.join(", ");
}
