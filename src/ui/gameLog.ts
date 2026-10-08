import { playerName } from "../i18n/names";
import { becauseText, triggeredLines } from "./autoText";
import { checkName } from "./warnings";
import { distanceText } from "./distance";
import { systemLabel } from "./systemLabels";
import {
  applyEvent,
  phaseName,
  sideName,
  rulerLength,
  systemOf,
  undoneSeqs,
  type AttackState,
  type GameRecord,
  type GameState,
  type LoggedEvent,
} from "../core";
import { isPlaceholder } from "../core/content/systems";
import { systemModule } from "../systems";
import { t, tn, gameText } from "../i18n";
import { describePackageChange } from "./packageChange";
export { describePackageChange };

/** A line of the game log as players read it. */
export type LogItem =
  /** A phase change, or (`rules`) a rules change both players agreed to mid-game. */
  | {
      kind: "header";
      key: string;
      text: string;
      rules?: true;
      /** A turn's header: its round, and "Round 2 · Ana" in words (for chapters and folding empty turns). */
      round?: number;
      turn?: string;
    }
  | {
      kind: "line";
      key: string;
      seq: number;
      text: string;
      undone: boolean;
      detail?: string[];
      /** A line that grows while a player keeps nudging a unit: read out once they stop (UX 180). */
      settle?: { unitId: string };
    };

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
  // Lines whose dice were rolled at the table and typed in (#37).
  const told = new Set<LogItem>();
  const toldSeqs = new Set<number>();
  // A system procedure (any game's attack) is one line, updated as it is rolled.
  let procLine: Extract<LogItem, { kind: "line" }> | null = null;
  // A code procedure (an Old World combat, say): its first note heads one item, every later step a detail line.
  let scriptItem: Extract<LogItem, { kind: "line" }> | null = null;
  // Its first step only asked a question: the first line it writes later becomes the heading.
  let scriptHeadless = false;
  // Deployment: one line per player and army, however many units it had.
  let deployLine:
    (Extract<LogItem, { kind: "line" }> & { by: string; army?: string; units: number; pts: number }) | null =
    null;
  // A move action ("Spears marches"): the moves that follow add up on its line.
  let moveLine:
    (Extract<LogItem, { kind: "line" }> & { unitId: string; verb: string; inches: number }) | null = null;
  // Setting up the table ("Game: …", "Table set up") can happen several times before the battle: only the latest shows.
  const setup: Record<string, Extract<LogItem, { kind: "line" }>> = {};
  // Back-to-back drags of one unit by one player (arrow-key nudges, say) add up on one line (UX 180).
  // Measured from where the first one started, as the unit card measures moves (UX 200).
  let dragLine:
    (Extract<LogItem, { kind: "line" }> & { by: string; unitId: string; from: GameState }) | null = null;
  // Browsing dice sets is one line: the last pick, not every one tried (PX-5 review).
  const dicePick: { player: string; line: LogItem | null } = { player: "", line: null };
  // A game from a package names it; until it runs here, the log says so by that name, not the raw id.
  const packaged = [...record.events]
    .reverse()
    .find((e) => e.event.type === "game/packages" && !e.event.system.builtIn)?.event;
  const packageName = packaged?.type === "game/packages" ? packaged.packages[0]?.name : undefined;
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
      // Past the last round the battle is over: no "Round 6" that never happens (UX 280).
      const rounds = systemOf(state).turn.rounds;
      if (typeof rounds === "number" && state.turn.round > rounds)
        items.push({
          kind: "header",
          key,
          text: t("The battle is over"),
          round: state.turn.round,
          turn: t("The battle is over"),
        });
      else items.push({ kind: "header", key, ...turnHeader(state) });
      // A roll-off for who goes first this round (Conquest's Supremacy, #40).
      if (state.rolledOff) {
        const r = state.rolledOff;
        const p = {
          rolls: r.rolls.map((rolls, seat) => `${sideName(state, seat)} ${rolls.join(", ")}`).join(" · "),
          side: sideName(state, r.seat),
          rule: gameText(systemOf(state).turn.rollOffName ?? ""),
        };
        items.push({
          kind: "line",
          key: `${key}/r`,
          seq: logged.seq,
          // Named for the rule where the game has one (Conquest's Supremacy, UX 304).
          text: p.rule
            ? t("{rule} roll-off: {rolls}. {side} goes first.", p)
            : t("Roll-off: {rolls}. {side} goes first.", p),
          undone: false,
        });
      }
      // Automated abilities that went off as the phase changed (#38).
      triggeredLines(state).forEach((text, i) =>
        items.push({ kind: "line", key: `${key}/t${i}`, seq: logged.seq, text, undone: false }),
      );
      continue;
    }
    if (!skipped && event.type === "game/packages" && event.agreed && before.packages) {
      items.push({ kind: "header", key, text: describe(logged, before, state), rules: true });
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
      const who = playerName(state.players[logged.by]) ?? t("Someone");
      const { units, pts: total } = deployLine;
      const params = { name: who, army: army ?? t("an army"), pts: String(total) };
      deployLine.text =
        units === 1 && !army
          ? t("{name} deployed {unit}", { name: who, unit: event.unit.name })
          : total
            ? tn(
                units,
                "{name} deployed {army} ({n} unit, {pts} pts)",
                "{name} deployed {army} ({n} units, {pts} pts)",
                params,
              )
            : tn(units, "{name} deployed {army} ({n} unit)", "{name} deployed {army} ({n} units)", params);
      continue;
    }
    deployLine = null;
    // A closed data procedure can start a code one: log that as the code procedure's first step.
    const scriptStep =
      event.type === "script/step" ? event : event.type === "procedure/clear" ? event.script : undefined;
    if (event.type === "procedure/clear" && scriptStep) procLine = null;
    if (scriptStep) {
      const lines = scriptLines(scriptStep, before, state);
      // A rule that ran and finished without a word (an aftermath with no losses) stays out of the log.
      if (!lines.length && !scriptStep.script && !(scriptItem && before.script)) {
        scriptItem = null;
        continue;
      }
      if (scriptItem && before.script && !skipped) {
        if (scriptHeadless && lines.length) {
          scriptItem.text = lines.shift()!;
          scriptHeadless = false;
        }
        (scriptItem.detail ??= []).push(...lines);
      } else {
        scriptHeadless = !lines.length;
        const who = playerName(state.players[logged.by]) ?? t("Someone");
        const rule = scriptStep.script?.procedure;
        const [head, ...rest] = lines.length
          ? lines
          : [rule ? t("{name} ran {rule}", { name: who, rule }) : t("{name} ran a rule", { name: who })];
        scriptItem = { kind: "line", key, seq: logged.seq, text: head!, undone: skipped, detail: rest };
        items.push(scriptItem);
      }
      if (!scriptStep.script) scriptItem = null;
      continue;
    }
    if (logged.told) toldSeqs.add(logged.seq);
    if (event.type === "attack/declare" || event.type === "attack/roll") {
      const text = attackSummary(state.attack ?? event.attack, state);
      if (attackLine && event.type === "attack/roll") attackLine.text = text;
      else {
        attackLine = { kind: "line", key, seq: logged.seq, text, undone: skipped };
        items.push(attackLine);
      }
      if (logged.told) told.add(attackLine);
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
      if (logged.told) told.add(procLine);
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
    if (
      moveLine &&
      !skipped &&
      (event.type === "unit/move" || event.type === "unit/form") &&
      event.id === moveLine.unitId &&
      event.distance !== undefined &&
      !(
        event.type === "unit/move" &&
        event.how &&
        !["forward", "back", "sideways", "wheel"].includes(event.how)
      )
    ) {
      moveLine.inches += Math.abs(event.distance);
      // The verb is the game's own ("marches"), so the line keeps its order.
      moveLine.text = `${state.units[moveLine.unitId]?.name ?? t("A unit")} ${moveLine.verb} ${distanceText(state, moveLine.inches)}`;
      continue;
    }
    if (event.type !== "undo") moveLine = null;
    if (
      event.type === "unit/move" &&
      !skipped &&
      event.how === "drag" &&
      event.turn === 0 &&
      event.distance !== undefined &&
      dragLine?.by === logged.by &&
      dragLine.unitId === event.id &&
      items.at(-1) === dragLine
    ) {
      dragLine.text = moveText(
        playerName(state.players[logged.by]) ?? t("Someone"),
        dragLine.from,
        state,
        state.units[event.id]?.modelIds ?? [],
      );
      continue;
    }
    if (event.type !== "undo") dragLine = null;
    if (event.type === "undo") {
      // Say what was taken back (UX 130): an attack by name, else the line it made.
      const who = playerName(state.players[logged.by]) ?? t("Someone");
      const line = items.find((i) => i.kind === "line" && i.seq === event.seq);
      const declared = record.events.find((e) => e.seq === event.seq)?.event;
      const what =
        declared?.type === "attack/declare"
          ? undoGroup(record, event.seq, new Set(), state).what
          : line?.kind === "line"
            ? line.text
            : null;
      items.push({
        kind: "line",
        key,
        seq: logged.seq,
        text: what
          ? declared?.type === "attack/declare"
            ? t("{name} took back {what}", { name: who, what })
            : t("{name} took back “{what}”", { name: who, what })
          : t("{name} took back an action", { name: who }),
        undone: false,
      });
      continue;
    }
    let text = describe(logged, before, state);
    if (event.type === "game/system" && isPlaceholder(event.system))
      text = t("Game: {system}, its rules aren't loaded yet", { system: packageName ?? event.system });
    if (
      (event.type === "game/system" || event.type === "layout/set") &&
      !skipped &&
      !state.turn.round &&
      text
    ) {
      const earlier = setup[event.type];
      if (earlier) items.splice(items.indexOf(earlier), 1);
      const line = { kind: "line" as const, key, seq: logged.seq, text, undone: false };
      setup[event.type] = line;
      items.push(line);
      continue;
    }
    if (event.type === "player/dice" && !skipped && text) {
      if (dicePick.player === event.player && items.at(-1) === dicePick.line) items.pop();
      const line = { kind: "line" as const, key, seq: logged.seq, text, undone: false };
      Object.assign(dicePick, { player: event.player, line });
      items.push(line);
      continue;
    }
    if (event.type === "action/take" && !skipped && text) {
      const def = systemOf(state).actions.find((a) => a.id === event.action);
      if (def?.move && def.verb && !event.targetId) {
        moveLine = {
          kind: "line",
          key,
          seq: logged.seq,
          text,
          undone: false,
          unitId: event.unitId,
          verb: def.verb,
          inches: 0,
        };
        items.push(moveLine);
        continue;
      }
    }
    if (
      event.type === "unit/move" &&
      !skipped &&
      event.how === "drag" &&
      event.turn === 0 &&
      event.distance !== undefined &&
      text
    ) {
      dragLine = {
        kind: "line",
        key,
        seq: logged.seq,
        text,
        undone: false,
        settle: { unitId: event.id },
        by: logged.by,
        unitId: event.id,
        from: before,
      };
      items.push(dragLine);
      continue;
    }
    // Bookkeeping events (an empty description) stay out of the log.
    if (text) items.push({ kind: "line", key, seq: logged.seq, text, undone: skipped });
  }
  return items.map((i) =>
    i.kind === "line" && (told.has(i) || toldSeqs.has(i.seq))
      ? { ...i, text: t("{line} · own dice", { line: i.text }) }
      : i,
  );
}

function turnHeader(state: GameState): { text: string; round?: number; turn?: string } {
  const { round, activeSeat } = state.turn;
  if (round === 0) return { text: t("Deployment") };
  const player = sideName(state, activeSeat);
  return {
    text: t("Round {round} · {player} · {phase}", { round, player, phase: gameText(phaseName(state) ?? "") }),
    round,
    turn: t("Round {round} · {player}", { round, player }),
  };
}

/** "Line Troopers shot Ashen Thralls (Pattern Rifle): 16 attacks, 11 hits, 6 wounds, 2 unsaved, 2 slain". */
function attackSummary(a: AttackState, state: GameState): string {
  const s = a.spec;
  const name = (id: string) => state.units[id]?.name ?? t("a unit");
  const parts = [tn(a.attackCount, "{n} attack", "{n} attacks")];
  if (a.hits !== undefined) parts.push(tn(a.hits, "{n} hit", "{n} hits"));
  if (a.wounds !== undefined) parts.push(tn(a.wounds, "{n} wound", "{n} wounds"));
  if (a.unsaved !== undefined) parts.push(tn(a.unsaved, "{n} unsaved", "{n} unsaved"));
  if (a.damage) {
    const slain = a.damage.filter((d) => d.destroyed).length;
    const lost = a.damage.reduce((n, d) => n + d.lost, 0);
    parts.push(slain ? tn(slain, "{n} slain", "{n} slain") : tn(lost, "{n} wound lost", "{n} wounds lost"));
  }
  // The rules that changed the rolls, by name (UX 290).
  const because = becauseText(s);
  const params = {
    attacker: name(s.attackerUnitId),
    target: name(s.targetUnitId),
    weapon: s.weaponName,
    results: parts.join(", ") + (because ? ` · ${because}` : ""),
  };
  return s.kind === "melee"
    ? t("{attacker} fought {target} ({weapon}): {results}", params)
    : t("{attacker} shot {target} ({weapon}): {results}", params);
}

/**
 * What a finished procedure cost the target, read from the table after it:
 * "2 bases lost" where each wound took a base, else "4 wounds · 1 base
 * removed" (Conquest's multi-wound stands), or "destroyed".
 */
export function lossText(
  state: GameState,
  outcomes: { kind: string; modelId?: string; lost?: number }[],
  /** Rank-and-flank games count bases (stands); the others count models. */
  bases = true,
): string {
  if (outcomes.some((o) => o.kind === "destroy")) return t("destroyed");
  const hits = outcomes.filter((o) => o.kind === "wounds");
  const wounds = hits.reduce((sum, o) => sum + (o.lost ?? 1), 0);
  const removed = new Set(
    hits.filter((o) => o.modelId && state.models[o.modelId]?.destroyed).map((o) => o.modelId),
  ).size;
  if (!wounds) return t("no losses");
  if (!bases)
    return wounds === removed
      ? tn(removed, "{n} model slain", "{n} models slain")
      : `${tn(wounds, "{n} wound", "{n} wounds")} · ${tn(removed, "{n} model slain", "{n} models slain")}`;
  if (wounds === removed) return tn(removed, "{n} base lost", "{n} bases lost");
  return `${tn(wounds, "{n} wound", "{n} wounds")} · ${tn(removed, "{n} base removed", "{n} bases removed")}`;
}

/** "Raider Gang Carbines at Lancer Tank: hit 1/3, save 1/1, 0 bases lost". */
function procedureSummary(state: GameState): string {
  const proc = state.procedure;
  if (!proc) return "";
  const bases = systemOf(state).unitShape.kind === "ranked";
  // An attack (the computer's, or one run from data) reads like the player's own (UX 306):
  // "Cinder Brutes fought Lance Team (Ash Claws): 6 attacks, 3 hits, 2 wounds, 2 unsaved, 1 model slain".
  const rec = (id: string) => proc.run.records.find((r) => r.id === id);
  const weapon = proc.weapon ? state.units[proc.unitId]?.sheet?.weapons[proc.weapon] : undefined;
  if (weapon && proc.targetId && rec("hit") && rec("wound")) {
    const parts: string[] = [];
    const pool = proc.run.records.find((r) => r.kind === "pool");
    const attacks = pool?.out ?? rec("hit")!.in;
    parts.push(tn(attacks, "{n} attack", "{n} attacks"));
    const hit = rec("hit");
    const wound = rec("wound");
    const save = rec("save");
    if (hit) parts.push(tn(hit.out, "{n} hit", "{n} hits"));
    if (wound) parts.push(tn(wound.out, "{n} wound", "{n} wounds"));
    if (save) parts.push(tn(save.out, "{n} unsaved", "{n} unsaved"));
    if (proc.run.done) parts.push(lossText(state, proc.run.outcomes, bases));
    const params = {
      attacker: state.units[proc.unitId]?.name ?? t("a unit"),
      target: state.units[proc.targetId]?.name ?? t("a unit"),
      weapon: gameText(weapon.name),
      results: parts.join(", "),
    };
    return weapon.kind === "melee"
      ? t("{attacker} fought {target} ({weapon}): {results}", params)
      : t("{attacker} shot {target} ({weapon}): {results}", params);
  }
  const parts = proc.run.records
    .filter((r) => r.dice?.length)
    .map((r) => `${r.id} ${r.successes ?? 0}/${r.in}`);
  if (proc.run.done) parts.push(lossText(state, proc.run.outcomes, bases));
  return `${proc.title}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/** "Ann moved Troopers 6.0"": how far the furthest model moved, counting climbs. */
function moveText(who: string, before: GameState, after: GameState, ids: string[]): string {
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
  const p = { name: who, unit: unit?.name ?? "", distance: distanceText(after, far) };
  if (far < 0.05)
    return !unit
      ? t("{name} turned models", p)
      : whole
        ? t("{name} turned {unit}", p)
        : ids.length === 1
          ? t("{name} turned a model of {unit}", p)
          : tn(ids.length, "{name} turned {n} model of {unit}", "{name} turned {n} models of {unit}", p);
  return !unit
    ? t("{name} moved models {distance}", p)
    : whole
      ? t("{name} moved {unit} {distance}", p)
      : ids.length === 1
        ? t("{name} moved a model of {unit} {distance}", p)
        : tn(
            ids.length,
            "{name} moved {n} model of {unit} {distance}",
            "{name} moved {n} models of {unit} {distance}",
            p,
          );
}

export function describe({ by, event }: LoggedEvent, before: GameState, game: GameState): string {
  const nameOf = (id: string) => playerName(game.players[id]) ?? t("Someone");
  const who = nameOf(by);
  const unitName = (id: string) => game.units[id]?.name ?? t("a unit");
  switch (event.type) {
    case "player/join":
      return t("{name} joined", { name: playerName(game.players[event.player.id]) ?? event.player.name });
    case "player/claim":
      // Seats in a What if game are taken afresh, not reconnected to.
      return before.branch
        ? t("{name} took their seat", { name: nameOf(event.by) })
        : t("{name} reconnected", { name: nameOf(event.by) });
    case "mission/set":
      return t("{name} chose the mission {mission}", { name: who, mission: event.mission.name });
    case "score/confirm": {
      // "Crossfire: controls 2 objectives" reads as "Crossfire, controls 2 objectives".
      const why = event.why.replace(/^([^:]+): /, "$1, ");
      const side = sideName(game, event.seat);
      if (event.skipped) return t("{side} passed on {why}", { side, why });
      const changed = event.suggested !== undefined && event.suggested !== event.vp;
      return changed
        ? t("{side} scored {vp} VP (suggested {suggested}) · {why}", {
            side,
            vp: String(event.vp),
            suggested: String(event.suggested),
            why,
          })
        : t("{side} scored {vp} VP · {why}", { side, vp: String(event.vp), why });
    }
    case "player/dice": {
      const name = playerName(game.players[event.player]) ?? who;
      return event.dice
        ? t("{name} picked new dice", { name })
        : t("{name} picked their colour's dice", { name });
    }
    case "player/rename":
      return t("{old} is now {name}", {
        old: playerName(before.players[event.player]) ?? t("A player"),
        name: event.name,
      });
    case "player/color":
      return t("{name} changed their colour", { name: playerName(game.players[event.player]) ?? who });
    case "clock/pause":
      if (!event.paused) return t("{name} restarted the clocks", { name: who });
      return event.reason === "disconnect"
        ? t("The clocks stopped: a player is disconnected")
        : t("{name} stopped the clocks", { name: who });
    case "clock/call":
      return `⏱ ${event.text}`;
    case "clock/adjust": {
      const mins = Math.round(Math.abs(event.ms) / 60_000);
      const amount = mins
        ? tn(mins, "{n} minute", "{n} minutes")
        : tn(Math.round(Math.abs(event.ms) / 1000), "{n} second", "{n} seconds");
      const p = { name: who, side: sideName(game, event.seat), amount };
      return event.ms >= 0
        ? t("{name} gave {side} {amount} on the clock", p)
        : t("{name} took {amount} off {side}'s clock", p);
    }
    case "campaign/set": {
      if (!event.ref) return t("{name} stopped playing for a campaign", { name: who });
      const p = { name: who, book: event.ref.name, territory: event.ref.territory ?? "" };
      if (before.campaign?.id !== event.ref.id) return t("{name} brought the campaign book {book}", p);
      if (before.campaign.territory !== event.ref.territory)
        return event.ref.territory
          ? t("{name} set the stakes: {territory}", p)
          : t("{name} took the territory off the table", p);
      if (event.merged) return t("{book}: games from {name}'s copy were added to the table's", p);
      return event.recorded ? t("{book} recorded this game", p) : t("{name} shared their copy of {book}", p);
    }
    case "campaign/army":
      return "";
    case "dice/roll": {
      const { results, label, unitId, sides, faces } = event.roll;
      // The roller is the roll's own (a unit's owner in a rule), not whoever logged the step.
      const roller = nameOf(event.roll.by);
      const total = results.reduce((a, b) => a + b, 0);
      if (event.roll.need) {
        // "Warriors to hit 4+: 5 of 10 (6 5 5 4 4 3 2 2 1 1)"
        const n = results.filter((r) => r >= event.roll.need!).length;
        const dice = [...results].sort((a, b) => b - a).join(" ");
        const p = {
          unit: unitId ? unitName(unitId) : "",
          label: label ?? t("roll"),
          need: event.roll.need,
          n,
          total: results.length,
          dice,
        };
        return unitId
          ? t("{unit} {label} {need}+: {n} of {total} ({dice})", p)
          : t("{label} {need}+: {n} of {total} ({dice})", p);
      }
      // The game's own label for the roll (a unit's name before it), else dice like "2D6".
      const what = label ? `${unitId ? `${unitName(unitId)} ` : ""}${label}` : `${results.length}D${sides}`;
      if (faces)
        return t("{name} rolled {what}: {results}", {
          name: roller,
          what,
          results: results.map((r) => faces[r - 1] ?? r).join(" "),
        });
      return results.length > 1
        ? t("{name} rolled {what}: {results} (= {total})", {
            name: roller,
            what,
            results: results.join(" "),
            total: String(total),
          })
        : t("{name} rolled {what}: {results}", { name: roller, what, results: results.join(" ") });
    }
    case "undo":
      return t("{name} took back an action", { name: who });
    case "unit/add":
      return t("{name} deployed {unit} ({n})", { name: who, unit: event.unit.name, n: event.models.length });
    case "terrain/add":
      return t("{name} added {terrain}", { name: who, terrain: event.piece.name.toLowerCase() });
    case "terrain/update":
      return t("{name} changed {terrain}", { name: who, terrain: event.piece.name.toLowerCase() });
    case "terrain/remove":
      return t("{name} removed terrain", { name: who });
    case "player/ready": {
      const name = playerName(game.players[event.player]) ?? who;
      return event.ready ? t("{name} is ready", { name }) : t("{name} is not ready yet", { name });
    }
    case "game/packages": {
      const was = before.packages;
      const names = (ps: { name: string; version: string }[]) =>
        ps.map((p) => `${p.name} ${p.version}`).join(", ");
      if (event.agreed && was) {
        const changes = describePackageChange(was.packages, event.packages) || t("packages updated");
        return event.agreed.length === 2
          ? t("Rules changed: {changes} (both players agreed)", { changes })
          : event.agreed.length > 2
            ? t("Rules changed: {changes} (all players agreed)", { changes })
            : t("Rules changed: {changes} (agreed)", { changes });
      }
      return event.packages.length
        ? t("Rules packages: {packages}", { packages: names(event.packages) })
        : t("Rules packages: none (built-in rules only)");
    }
    case "packages/propose":
      return t("{name} proposed changing the rules: {changes}", {
        name: who,
        changes: describePackageChange(game.packages?.packages ?? [], event.packages) || t("no change"),
      });
    case "packages/accept":
      return t("{name} accepted the rules change", { name: playerName(game.players[event.player]) ?? who });
    case "packages/decline":
      return t("{name} declined the rules change", { name: playerName(game.players[event.player]) ?? who });
    case "packages/withdraw":
      return t("{name} withdrew the rules change", { name: who });
    case "player/resync":
      return t("{name} resynced from the host", { name: playerName(game.players[event.player]) ?? who });
    case "player/rules": {
      const names = (game.packages?.packages ?? []).filter((p) => event.missing.includes(p.hash));
      const name = playerName(game.players[event.player]) ?? who;
      return event.missing.length
        ? t("{name} is playing without {packages}: their table may disagree", {
            name,
            packages: names.map((p) => `${p.name} ${p.version}`).join(", ") || t("some of the rules"),
          })
        : t("{name} now has the game's rules", { name });
    }
    case "template/set": {
      const tpl = event.template;
      const old = before.templates?.[event.id];
      const p = { name: who, template: (tpl?.label ?? old?.label ?? t("template")).toLowerCase() };
      return tpl
        ? old
          ? t("{name} moved the {template}", p)
          : t("{name} placed the {template}", p)
        : t("{name} removed the {template}", p);
    }
    case "template/scatter": {
      const tpl = before.templates?.[event.id];
      const p = {
        name: who,
        template: (event.label ?? tpl?.label ?? t("template")).toLowerCase(),
        roll: event.distance,
        inches: Number(event.distance),
        direction: bearing(event.angle),
      };
      if (event.scatter.toLowerCase() === "hit") return t("{name} rolled a hit: the {template} stays put", p);
      if (!p.inches) return t("{name} rolled {roll} for the {template}: it doesn't move", p);
      const { width, depth } = game.table;
      const off = Math.abs(event.to.x) > width / 2 || Math.abs(event.to.y) > depth / 2;
      return off
        ? t('{name} scattered the {template} {inches}" towards the {direction}, off the table', p)
        : t('{name} scattered the {template} {inches}" towards the {direction}', p);
    }
    case "ruler/set": {
      const r = event.ruler;
      if (!r) return t("{name} cleared the ruler", { name: who });
      const end = (id?: string) => (id ? (game.models[id]?.label ?? t("a model")) : t("a point"));
      const distance = distanceText(game, rulerLength(game, r));
      return r.fromModel || r.toModel
        ? t("{name} measured {distance} ({from} to {to})", {
            name: who,
            distance,
            from: end(r.fromModel),
            to: end(r.toModel),
          })
        : t("{name} measured {distance}", { name: who, distance });
    }
    case "objective/move":
      return t("{name} moved an objective", { name: who });
    case "unit/figure":
      return event.figure
        ? t("{name} gave {unit} the figure {figure}", {
            name: who,
            unit: unitName(event.id),
            figure: event.figure.name,
          })
        : t("{name} took the figure off {unit}", { name: who, unit: unitName(event.id) });
    case "unit/height":
      return t('{name} set {unit} height to {height}"', {
        name: who,
        unit: unitName(event.id),
        height: event.height ?? t("default"),
      });
    case "settings/set": {
      const st = event.settings;
      const parts = [
        st.cover && (st.cover === "hit" ? t("cover −1 to hit") : t("cover +1 to save")),
        st.los &&
          (st.los === "heights"
            ? t("line of sight: stand-in heights")
            : st.los === "footprint"
              ? t("line of sight: footprints")
              : t("line of sight: true")),
        st.visionArc !== undefined &&
          (st.visionArc >= 360 ? t("vision all around") : t("vision {deg}° arc", { deg: st.visionArc })),
        st.modelsBlock !== undefined &&
          (st.modelsBlock ? t("models block sight") : t("models don't block sight")),
        st.companion && t("playing with real models (table companion)"),
      ].filter(Boolean);
      return t("{name} set {settings}", { name: who, settings: parts.join(", ") || t("game settings") });
    }
    case "unit/attach":
      return t("{name} attached {unit} to {other}", {
        name: who,
        unit: unitName(event.id),
        other: unitName(event.to),
      });
    case "unit/detach":
      return t("{unit} left {other}", {
        unit: game.units[event.unit]?.name ?? t("a unit"),
        other: unitName(event.id),
      });
    case "unit/remove":
      return t("{name} removed {unit}", { name: who, unit: unitName(event.id) });
    case "unit/move": {
      const p = {
        name: who,
        unit: unitName(event.id),
        deg: Math.round((Math.abs(event.turn) * 180) / Math.PI),
        distance: distanceText(game, event.distance ?? 0),
      };
      if (event.how === "wheel")
        return event.turn < 0
          ? t("{name} wheeled {unit} {deg}° right ({distance})", p)
          : t("{name} wheeled {unit} {deg}° left ({distance})", p);
      if (event.how === "door")
        return t("{name} closed the door: {unit} lined up with its target ({distance})", p);
      if (event.how === "charge") return t("{unit} charged {distance}", p);
      if (event.how === "flee") return t("{unit} fled {distance}", p);
      if (event.how === "pursue") return t("{unit} pursued {distance}", p);
      if (event.how === "back")
        return t("{name} moved {unit} back {distance}", {
          ...p,
          distance: distanceText(game, Math.abs(event.distance ?? 0)),
        });
      if (event.how === "sideways") return t("{name} moved {unit} sideways {distance}", p);
      if (event.how === "forward") {
        const q = { ...p, distance: distanceText(game, Math.abs(event.distance ?? 0)) };
        return (event.distance ?? 0) < 0
          ? t("{name} moved {unit} back {distance}", q)
          : t("{name} moved {unit} forward {distance}", q);
      }
      return moveText(who, before, game, game.units[event.id]?.modelIds ?? []);
    }
    case "unit/form": {
      const f = event.formation;
      const p = {
        name: who,
        unit: unitName(event.id),
        files: f.kind === "ranked" ? f.files : 0,
        cost: event.distance ? ` (${Number(event.distance.toFixed(1))}")` : "",
      };
      if (event.how === "order") {
        if (f.kind !== "ranked") return t("{name} sent {unit} out as skirmishers", p);
        const order = f.order ?? "close";
        return order === "column"
          ? t("{name} put {unit} in column order", p)
          : order === "open"
            ? t("{name} put {unit} in open order", p)
            : order === "disrupted"
              ? t("{name} put {unit} in disrupted order", p)
              : t("{name} put {unit} in close order", p);
      }
      if (event.how === "turn") {
        const id = game.units[event.id]?.modelIds[0] ?? "";
        const from = before.models[id]?.facing ?? 0;
        const to = game.models[id]?.facing ?? from;
        const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
        return Math.abs(Math.abs(d) - Math.PI) < 0.1
          ? t("{name} turned {unit} about{cost}", p)
          : d > 0
            ? t("{name} turned {unit} left{cost}", p)
            : t("{name} turned {unit} right{cost}", p);
      }
      if (event.how === "redress")
        return f.kind === "ranked"
          ? t("{name} redressed {unit} {files} wide{cost}", p)
          : t("{name} redressed {unit}{cost}", p);
      return f.kind === "ranked"
        ? t("{name} reformed {unit} {files} wide{cost}", p)
        : t("{name} reformed {unit}{cost}", p);
    }
    case "model/move":
      return moveText(who, before, game, [event.id]);
    case "models/move":
      if (event.setup) return "";
      if (event.snap !== undefined) {
        const unitId = game.models[event.moves[0]?.id ?? ""]?.unitId;
        return t('{unit} snapped back to {inches}"', { unit: unitName(unitId ?? ""), inches: event.snap });
      }
      return moveText(
        who,
        before,
        game,
        event.moves.map((m) => m.id),
      );
    case "unit/automate":
      return event.auto
        ? t("{name} automated {unit}'s {ability}", {
            name: who,
            unit: unitName(event.id),
            ability: event.ability,
          })
        : t("{name} stopped automating {unit}'s {ability}", {
            name: who,
            unit: unitName(event.id),
            ability: event.ability,
          });
    case "unit/status": {
      const p = { name: who, unit: unitName(event.id), spell: event.key.slice(6) };
      // A damage track's box set by hand (FSD's damaged systems, UX 264), and the placed dice it cost.
      const damage = /^damage(\w+)$/.exec(event.key);
      if (damage) {
        const sys = /^S(\d)$/.exec(damage[1]!);
        const what = sys ? t("system {n}", { n: sys[1]! }) : damage[1]!;
        const line = event.value
          ? t("{name} marked {unit} damaged: {what}", { ...p, what })
          : t("{name} cleared {unit}'s damage: {what}", { ...p, what });
        const lost = lostDice(before, game, event.id);
        return lost.length ? `${line} ${t("(placed dice lost: {faces})", { faces: lost.join(", ") })}` : line;
      }
      if (event.key.startsWith("autoUsed.")) return "";
      if (event.key.startsWith("auto."))
        return event.value ? t("{unit} used {ability}", { ...p, ability: event.key.slice(5) }) : "";
      if (event.key === "marching")
        return event.value ? t("{unit} is marching", p) : t("{unit} stopped marching", p);
      if (event.key === "disrupted")
        return event.value ? t("{unit} is disrupted", p) : t("{unit} is no longer disrupted", p);
      if (event.key === "fleeing") return event.value ? t("{unit} is fleeing", p) : t("{unit} rallied", p);
      if (event.key === "lastFiles") return "";
      if (event.key.startsWith("spell:"))
        return event.value ? t("{unit} is under {spell}", p) : t("{spell} on {unit} ended", p);
      // An override from the Table warnings panel (src/ui/warnings.ts).
      if (event.key.startsWith("ok."))
        return event.value === null
          ? ""
          : t("{name} marked {unit} as fine: {check}", {
              ...p,
              check: checkName(game, event.key.slice(3)).toLowerCase(),
            });
      return t("{name} set {unit} {key} = {value}", {
        ...p,
        key: event.key,
        value: event.value === null || event.value === undefined ? t("off") : String(event.value),
      });
    }
    case "model/wounds": {
      const p = { name: who, model: game.models[event.id]?.label ?? t("a model") };
      return event.destroyed
        ? t("{name} set wounds on {model} (destroyed)", p)
        : t("{name} set wounds on {model}", p);
    }
    case "layout/set":
      return t("Table set up");
    case "resource/adjust":
      return `${nameOf(event.player)} ${event.delta > 0 ? "+" : ""}${event.delta} ${event.resource}`;
    case "attack/clear":
      return t("Attack cancelled");
    case "action/take": {
      const weapon = event.weapon ? game.units[event.unitId]?.sheet?.weapons[event.weapon]?.name : undefined;
      const def = systemOf(game).actions.find((a) => a.id === event.action);
      const action = def?.name ?? event.action;
      // Activation games read as sentences: "Spears activates (2 actions)", "Spears marches" (UX 112).
      if (def?.activates !== undefined) {
        const n = Number(game.units[event.unitId]?.status?.actionBudget ?? 0);
        const unit = unitName(event.unitId);
        return n
          ? tn(n, "{unit} activates ({n} action)", "{unit} activates ({n} actions)", { unit })
          : t("{unit} activates", { unit });
      }
      // The verb or action is the game's own ("Spears marches"), so the line keeps its order.
      const also = event.with?.length
        ? t(" with {units}", { units: event.with.map(unitName).join(", ") })
        : "";
      const target = event.targetId ? t(" at {unit}", { unit: unitName(event.targetId) }) : "";
      const hold = event.hold ? t(", waiting on a reaction") : "";
      if (def?.verb)
        return `${unitName(event.unitId)} ${def.verb}${weapon ? ` (${weapon})` : ""}${target}${also}${hold}`;
      return `${unitName(event.unitId)}: ${action}${weapon ? ` (${weapon})` : ""}${target}${also}${hold}`;
    }
    case "reaction/end":
      return t("Reaction over");
    case "procedure/clear":
      return t("Roll closed");
    case "turn/pass":
      return t("{name} passed", { name: who });
    case "turn/endActivation":
      return t("{name} ended the activation", { name: who });
    case "pool/set":
      return t("{name} re-rolled or spent dice", { name: nameOf(event.player) });
    case "dice/place": {
      const face =
        before.pools?.[event.player] && Object.values(before.pools[event.player]!)[0]?.[event.index];
      const weapon = game.units[event.unitId]?.sheet?.weapons[event.weapon]?.name ?? t("a card");
      return face
        ? t("{name} placed a {face} on {unit}'s {weapon}", {
            name: nameOf(event.player),
            face: String(face),
            unit: unitName(event.unitId),
            weapon,
          })
        : t("{name} placed a die on {unit}'s {weapon}", {
            name: nameOf(event.player),
            unit: unitName(event.unitId),
            weapon,
          });
    }
    case "dice/discard": {
      const weapon = game.units[event.unitId]?.sheet?.weapons[event.weapon]?.name ?? t("a card");
      return t("{name} discarded the dice on {unit}'s {weapon}", {
        name: nameOf(event.player),
        unit: unitName(event.unitId),
        weapon,
      });
    }
    case "game/branch": {
      const b = event.branch;
      const again = b.droppedSecrets
        ? tn(
            b.droppedSecrets,
            " {n} secret stayed behind: lock them in again.",
            " {n} secrets stayed behind: lock them in again.",
          )
        : "";
      const rule = b.droppedScript
        ? t(' "{rule}" was waiting on a player and didn\'t carry over.', { rule: b.droppedScript })
        : "";
      // The moment in words (UX 137); the parent's hash stays on the replay's title card.
      return t("What if: from {moment}.{secrets}{rule}", {
        moment: b.moment ?? b.title,
        secrets: again,
        rule,
      });
    }
    case "secret/commit": {
      const n = event.secrets.length;
      const p = { name: nameOf(event.player), secret: event.label ?? t("a secret") };
      return n > 1
        ? t("{name} locked in {secret}: {n} cards, face down", { ...p, n })
        : t("{name} locked in {secret}", p);
    }
    case "secret/reveal": {
      // A unit id reads as its name ("drew Warden Guard"); anything else as written.
      const v = event.value;
      const card = event.key.startsWith("mission:")
        ? systemModule(game.system)
            .missions?.find((m) => m.id === game.mission?.id)
            ?.deck?.find((c) => c.id === v)
        : undefined;
      const shown = card
        ? card.name
        : typeof v === "string" && game.units[v]
          ? game.units[v]!.name
          : JSON.stringify(v);
      const ok = game.secrets?.[event.player]?.[event.key]?.revealed;
      const p = { name: nameOf(event.player), secret: event.label ?? t("a secret"), shown };
      return ok
        ? t("{name} revealed {secret}: {shown}", p)
        : t("{name} revealed {secret}: {shown} (didn't match what was locked in)", p);
    }
    case "game/system":
      return t("Game: {system}", { system: systemLabel(game.system, systemOf(game).name) });
    case "player/action": {
      const name =
        event.label ?? systemOf(game).actions.find((a) => a.id === event.action)?.name ?? event.action;
      const spent = event.payment
        .map((p) => {
          const r = systemOf(game).resources?.find((x) => x.id === p.resource);
          return `${p.amount ?? p.indices?.length ?? 0} ${r?.short ?? r?.name ?? p.resource}`;
        })
        .join(", ");
      const p = {
        name: nameOf(event.player),
        action: name,
        unit: event.targetId ? unitName(event.targetId) : "",
        spent,
      };
      if (event.targetId)
        return spent
          ? t("{name} used {action} on {unit} ({spent})", p)
          : t("{name} used {action} on {unit}", p);
      return spent ? t("{name} used {action} ({spent})", p) : t("{name} used {action}", p);
    }
    case "ability/apply":
      return t("{unit}: {ability} applied", { unit: unitName(event.unitId), ability: event.ability });
    case "unit/reserve": {
      const unit = unitName(event.id);
      return event.reserve
        ? t("{unit} went into reserves", { unit })
        : before.turn.round === 0
          ? t("{unit} back on the table", { unit })
          : t("{unit} arrives from reserves", { unit });
    }
    case "unit/specialMove":
      return t('{unit} may move up to {inches}" ({flag})', {
        unit: unitName(event.id),
        inches: event.inches,
        flag: event.flag,
      });
    case "attack/allocate":
      return t("{name} chose the order their models take wounds", { name: who });
    case "module/set":
      return "";
    case "log/note":
      return event.text;
    case "campaign/award": {
      const name = game.units[event.unitId ?? ""]?.name ?? t("A unit");
      const bits = [
        event.xp ? t("{xp} XP", { xp: `${event.xp > 0 ? "+" : ""}${event.xp}` }) : "",
        event.honour ? t("honour: {honour}", { honour: event.honour }) : "",
        event.scar ? t("scar: {scar}", { scar: event.scar }) : "",
      ].filter(Boolean);
      return bits.length ? `${name}: ${bits.join(", ")}` : "";
    }
    case "procedure/outcomes": {
      const lost = event.outcomes
        .filter((o) => o.kind === "wounds")
        .reduce((n, o) => n + (o.kind === "wounds" ? o.lost : 0), 0);
      const parts = event.outcomes.flatMap((o) =>
        o.kind === "status"
          ? [
              o.value
                ? t("{unit} is {status}", { unit: unitName(o.unitId), status: o.status })
                : t("{unit} is no longer {status}", { unit: unitName(o.unitId), status: o.status }),
            ]
          : o.kind === "destroy"
            ? [t("{unit} destroyed", { unit: unitName(o.unitId) })]
            : o.kind === "note" || o.kind === "reminder"
              ? [o.text]
              : [],
      );
      if (lost) parts.unshift(tn(lost, "{n} wound lost", "{n} wounds lost"));
      return parts.join(", ");
    }
    default:
      return `${who}: ${(event as { type: string }).type}`;
  }
}

/**
 * A code procedure's step as log lines: its notes and rolls, casualties folded
 * per unit. Module bookkeeping and status flags stay out (the notes say what
 * they mean), and so does the waiting question, which the question panel asks.
 */
function scriptLines(
  event: Extract<LoggedEvent["event"], { type: "script/step" }>,
  before: GameState,
  game: GameState,
) {
  const unitName = (id: string) => game.units[id]?.name ?? t("a unit");
  const by = event.script?.by ?? "";
  const noted = event.events.some((e) => e.type === "log/note");
  const lines: string[] = [];
  for (let i = 0; i < event.events.length; i++) {
    const e = event.events[i]!;
    if (e.type === "module/set" || e.type === "unit/status") continue;
    if (e.type === "model/wounds") {
      // Casualties in a row on one unit read as one line.
      const unitId = game.models[e.id]?.unitId;
      let lost = 0;
      let hurt = 0;
      let back = 0;
      for (; i < event.events.length; i++) {
        const x = event.events[i]!;
        if (x.type !== "model/wounds" || game.models[x.id]?.unitId !== unitId) break;
        if (x.destroyed) lost++;
        // A rule that brings a fallen model back (a package's, say).
        else if (before.models[x.id]?.destroyed) back++;
        else hurt++;
      }
      i--;
      const bits = [
        lost ? tn(lost, "{n} model lost", "{n} models lost") : "",
        hurt ? tn(hurt, "{n} wounded", "{n} wounded") : "",
        back ? tn(back, "{n} back in the fight", "{n} back in the fight") : "",
      ];
      lines.push(`${unitName(unitId ?? "")}: ${bits.filter(Boolean).join(", ")}`);
      continue;
    }
    // A unit moved by the rule (fleeing, giving ground) is said by the rule's own note; so are a
    // regiment's reshuffles when a step says what happened ("Fen Marshal joined Fen Bowmen", UX 321).
    if (e.type === "unit/move") continue;
    if (
      noted &&
      (e.type === "unit/attach" ||
        e.type === "unit/detach" ||
        e.type === "unit/form" ||
        e.type === "models/move")
    )
      continue;
    const text = describe({ by, event: e, seq: 0, at: 0 }, before, game);
    if (text) lines.push(text);
  }
  if (event.error) lines.push(t("stopped: {error}", { error: event.error }));
  return lines;
}

/**
 * The log for reading: phases nothing happened in fold away. A whole player
 * turn with no actions becomes one "Round 1 · Player 2: no actions" line, and
 * empty phases before one with actions are dropped. The replay track keeps
 * using the full log.
 */
export function collapseEmpty(log: LogItem[]): LogItem[] {
  const out: LogItem[] = [];
  // The turn a header belongs to ("Round 1 · Ann"); headers made elsewhere are read from their text.
  const turnOf = (h: Extract<LogItem, { kind: "header" }>) =>
    h.turn ?? /^(Round \d+ · [^·]+?) · /.exec(h.text)?.[1] ?? h.text;
  let run: Extract<LogItem, { kind: "header" }>[] = [];
  // The turn of the last header shown: its later empty phases just drop.
  let shownTurn = "";
  const flush = () => {
    if (!run.length) return;
    const last = run.at(-1)!;
    const lastTurn = turnOf(last);
    let i = 0;
    while (i < run.length) {
      const turn = turnOf(run[i]!);
      let j = i;
      while (j + 1 < run.length && turnOf(run[j + 1]!) === turn) j++;
      if (turn !== lastTurn && turn !== shownTurn)
        out.push({ kind: "header", key: run[i]!.key, text: t("{turn}: no actions", { turn }) });
      i = j + 1;
    }
    out.push(last);
    shownTurn = lastTurn;
    run = [];
  };
  for (const item of log) {
    if (item.kind === "header" && !item.rules) run.push(item);
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
  const names = [
    t("right"),
    t("bottom-right"),
    t("bottom"),
    t("bottom-left"),
    t("left"),
    t("top-left"),
    t("top"),
    t("top-right"),
  ];
  const a = Math.atan2(dy, dx); // 0 = right, pi/2 = down the screen (+y)
  const i = Math.round(a / (Math.PI / 4));
  return names[((i % 8) + 8) % 8]!;
}

const ATTACK_STEPS = new Set(["attack/roll", "attack/allocate", "attack/clear"]);

/**
 * What one Undo takes back (UX 130): the last event, or, when it belongs to
 * an attack, the whole attack from its declaration, casualties and all.
 */
export function undoGroup(
  record: GameRecord,
  seq: number,
  undone: ReadonlySet<number>,
  /** For the units' names. */
  game: GameState,
): { seq: number; also: number[]; what: string | null } {
  const i = record.events.findIndex((e) => e.seq === seq);
  const last = record.events[i];
  if (!last || !(ATTACK_STEPS.has(last.event.type) || last.event.type === "attack/declare"))
    return { seq, also: [], what: null };
  const also: number[] = [];
  for (let j = i; j >= 0; j--) {
    const { seq: s, event } = record.events[j]!;
    if (undone.has(s)) continue;
    if (event.type === "attack/declare") {
      const spec = event.attack.spec;
      const name = (id: string) => game.units[id]?.name ?? t("a unit");
      const p = { unit: name(spec.attackerUnitId), target: name(spec.targetUnitId) };
      // "Line Troopers'", "Warden's".
      const plural = /s$/i.test(p.unit);
      return {
        seq: s,
        also,
        what:
          spec.kind === "melee"
            ? plural
              ? t("{unit}' fight with {target}", p)
              : t("{unit}'s fight with {target}", p)
            : plural
              ? t("{unit}' shooting at {target}", p)
              : t("{unit}'s shooting at {target}", p),
      };
    }
    if (!ATTACK_STEPS.has(event.type)) break;
    also.push(s);
  }
  return { seq, also: [], what: null };
}

/** Dice that were placed on a unit's cards before and are gone after (dropped, not spent). */
function lostDice(before: GameState, after: GameState, unitId: string): number[] {
  const owner = before.units[unitId]?.owner;
  if (!owner) return [];
  const out: number[] = [];
  for (const [key, faces] of Object.entries(before.placed?.[owner] ?? {})) {
    if (!key.startsWith(`${unitId}/`)) continue;
    const left = [...(after.placed?.[owner]?.[key] ?? [])];
    for (const f of faces) {
      const i = left.indexOf(f);
      if (i >= 0) left.splice(i, 1);
      else out.push(f);
    }
  }
  return out;
}
