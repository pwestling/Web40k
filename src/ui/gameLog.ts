import {
  applyEvent,
  PHASES,
  rulerLength,
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
    if (event.type === "attack/clear") {
      // Folded into the attack's own line.
      if (attackLine) {
        attackLine = null;
        continue;
      }
    }
    items.push({
      kind: "line",
      key,
      seq: logged.seq,
      text: describe(logged, before, state),
      undone: skipped,
    });
  }
  return items;
}

function turnHeader(state: GameState): string {
  const { round, activeSeat, phase } = state.turn;
  if (round === 0) return "Deployment";
  const player =
    Object.values(state.players).find((p) => p.seat === activeSeat)?.name ?? `Player ${activeSeat + 1}`;
  return `Round ${round} · ${player} · ${PHASES[phase] ?? ""}`;
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

/** How far the furthest model moved, counting climbs. */
function moveText(before: GameState, after: GameState, ids: string[]): string {
  let far = 0;
  let unitId: string | undefined;
  for (const id of ids) {
    const a = before.models[id];
    const b = after.models[id];
    if (!a || !b) continue;
    unitId ??= a.unitId;
    const d = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, (b.z ?? 0) - (a.z ?? 0));
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
      const { results, label, unitId, sides } = event.roll;
      const total = results.reduce((a, b) => a + b, 0);
      const what = label ? `${unitId ? `${unitName(unitId)} ` : ""}${label}` : `${results.length}D${sides}`;
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
    case "ruler/set": {
      const r = event.ruler;
      if (!r) return `${who} cleared the ruler`;
      const name = (id?: string) => (id ? (game.models[id]?.label ?? "a model") : "a point");
      const ends = r.fromModel || r.toModel ? ` (${name(r.fromModel)} to ${name(r.toModel)})` : "";
      return `${who} measured ${rulerLength(game, r).toFixed(1)}"${ends}`;
    }
    case "objective/move":
      return `${who} moved an objective`;
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
    case "unit/move":
      return `${who} ${moveText(before, game, game.units[event.id]?.modelIds ?? [])}`;
    case "model/move":
      return `${who} ${moveText(before, game, [event.id])}`;
    case "models/move":
      return `${who} ${moveText(
        before,
        game,
        event.moves.map((m) => m.id),
      )}`;
    case "unit/status":
      return `${who} set ${unitName(event.id)} ${event.key} = ${event.value ?? "off"}`;
    case "model/wounds":
      return `${who} set wounds on ${game.models[event.id]?.label ?? "a model"}${event.destroyed ? " (destroyed)" : ""}`;
    case "layout/set":
      return "Table set up";
    case "resource/adjust":
      return `${nameOf(event.player)} ${event.delta > 0 ? "+" : ""}${event.delta} ${event.resource}`;
    case "attack/clear":
      return "Attack cancelled";
    default:
      return `${who}: ${(event as { type: string }).type}`;
  }
}
