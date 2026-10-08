import { playerName } from "../i18n/names";
import { becauseText, triggeredLines } from "./autoText";
import { distanceText } from "./distance";
import {
  applyEvent,
  phaseName,
  sideName,
  systemOf,
  undoneSeqs,
  type AttackState,
  type GameRecord,
  type GameState,
  type LoggedEvent,
} from "../core";
import { isPlaceholder } from "../core/content/systems";
import { t, tn, gameText } from "../i18n";
import { describePackageChange } from "./packageChange";
import { describe, moveText } from "./eventText";
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
        // A rule that hasn't said anything yet (it is waiting on a question) gets its line when it does:
        // no engine wording like "ran shoot" (UX 328). One left empty is dropped below.
        scriptHeadless = !lines.length;
        const [head = "", ...rest] = lines;
        scriptItem = { kind: "line", key, seq: logged.seq, text: head, undone: skipped, detail: rest };
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
  return items
    .filter((i) => i.kind !== "line" || i.text)
    .map((i) =>
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
