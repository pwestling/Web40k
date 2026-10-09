import { playerName } from "../i18n/names";
import { reasonFor } from "../bot/reasons";
import { checkName } from "./warnings";
import { distanceText } from "./distance";
import { systemLabel } from "./systemLabels";
import { sideName, rulerLength, systemOf, type GameState, type LoggedEvent } from "../core";
import { findAction } from "../core/content/player";
import { systemModule } from "../systems";
import { t, tn } from "../i18n";
import { describePackageChange } from "./packageChange";

/**
 * One line of the game log for each kind of event: what happened, in words,
 * from the state before and after it. buildLog (gameLog.ts) puts the lines
 * together into turns, attacks and moments.
 */

/** "Ann moved Troopers 6.0"": how far the furthest model moved, counting climbs. */
export function moveText(who: string, before: GameState, after: GameState, ids: string[]): string {
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

export function describe(logged: LoggedEvent, before: GameState, game: GameState): string {
  const text = describeEvent(logged, before, game);
  // The computer's reason for a move, in a solo game (PX solo review B).
  const why = reasonFor(logged);
  return why ? `${text}, ${why}` : text;
}

function describeEvent({ by, event }: LoggedEvent, before: GameState, game: GameState): string {
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
      return event.mission
        ? t("{name} chose the mission {mission}", { name: who, mission: event.mission.name })
        : t("{name} chose no mission: scoring by hand", { name: who });
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
    case "player/army": {
      const army = event.army;
      if (!army) return t("{name} cleared their army rules", { name: who });
      const rules = army.rules.length + army.stratagems.length;
      return army.detachment
        ? tn(rules, "{name} brings {detachment} ({n} rule)", "{name} brings {detachment} ({n} rules)", {
            name: who,
            detachment: army.detachment,
          })
        : tn(
            rules,
            "{name} brings their army's rules ({n} rule)",
            "{name} brings their army's rules ({n} rules)",
            {
              name: who,
            },
          );
    }
    case "player/color":
      // Before the battle it's setting up (an army brings its colour, UX 335), not news.
      if (game.turn.round === 0) return "";
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
        // A game's label may carry the score itself ("saves on 4+ (Shieldwall)") and the unit's name.
        if (p.unit && p.label.startsWith(p.unit)) p.unit = "";
        if (p.label.includes(`${p.need}+`))
          return p.unit
            ? t("{unit} {label}: {n} of {total} ({dice})", p)
            : t("{label}: {n} of {total} ({dice})", p);
        return p.unit
          ? t("{unit} {label} {need}+: {n} of {total} ({dice})", p)
          : t("{label} {need}+: {n} of {total} ({dice})", p);
      }
      // The game's own label for the roll (a unit's name before it), else dice like "2D6".
      const prefix = unitId && !label?.startsWith(unitName(unitId)) ? `${unitName(unitId)} ` : "";
      const what = label ? `${prefix}${label}` : `${results.length}D${sides}`;
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
      // The same packages at the same versions (a workshop save reloading its draft) needn't be said again (UX 310).
      if (was && names(was.packages) === names(event.packages)) return "";
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
        st.cover && (st.cover === "hit" ? t("cover: Ballistic Skill 1 worse") : t("cover +1 to save")),
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
      const also = event.with?.length
        ? t(" with {units}", { units: event.with.map(unitName).join(", ") })
        : "";
      // Activation games read as sentences: "Spears activates (2 actions)", "Spears marches" (UX 112).
      // Units it commands are named too: "Lancer activates (2 actions) with Raiders" (dogfood #54).
      if (def?.activates !== undefined) {
        const n = Number(game.units[event.unitId]?.status?.actionBudget ?? 0);
        const unit = unitName(event.unitId);
        return (
          (n
            ? tn(n, "{unit} activates ({n} action)", "{unit} activates ({n} actions)", { unit })
            : t("{unit} activates", { unit })) + also
        );
      }
      // The verb or action is the game's own ("Spears marches"), so the line keeps its order.
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
      return event.unit
        ? t("{unit} moved and ended its go", { unit: unitName(event.unit) })
        : t("{name} ended the activation", { name: who });
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
      const name = event.label ?? findAction(game, event.action)?.name ?? event.action;
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
 * A scatter direction as seen on screen from the default view: seat 0's edge
 * (+y) is at the bottom, +x to the right.
 */
function bearing(facing: number): string {
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
