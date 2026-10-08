import { touch } from "./touch";
import { opposed, sideName, type GameState, type Unit } from "../core";
import { aliveModels, unitDistance, weaponReach } from "../systems/wh40k/rules";
import { actingUnits, placedKey, unitActions, weaponSlots } from "../core/content/play";
import { currentSlot, phaseName, plainActivations, turnView } from "../core/content/turn";
import { gameView } from "../core/script";
import { useStore } from "../store";
import { gameModule, systemModule } from "../systems";
import { useHelp } from "./help";
import { useCoach } from "../teach/store";
import { useGame } from "./hooks";
import { useSandbox } from "../sandbox/runtime";
import { battleOver } from "./StatsScreen";
import { t, tn, gameText } from "../i18n";

/**
 * "What can I do now?" (front door): the current phase in plain words, built
 * from the rules: which of the side's units can take which actions right now
 * (the system's own actions, and a game module's code actions), how to do
 * them, and how to move on. For a first-time player, so they never stall.
 */
export function whatNow(
  game: GameState,
  me: string | null,
  hotseat: boolean,
  /** A package game's code actions ready now, by unit (worked out in its sandbox). */
  ready: Record<string, string[]> = {},
): { head: string; lines: string[]; units?: { id: string; text: string }[] } {
  const raw = phaseName(game) ?? "";
  // Shown in this device's language (UX 277); the checks below read the English name.
  const phase = gameText(raw);
  const side = game.turn.activeSeat;
  const who = sideName(game, side);
  const mine = hotseat || game.players[me ?? ""]?.seat === side;
  if (battleOver(game))
    return { head: t("The battle is over"), lines: [t("The stats screen shows how it went.")] };
  if (game.turn.round === 0)
    return {
      head: t("Deployment"),
      lines: [
        t("Drag your units into your deployment zone, the shaded strip on your side."),
        t("No army yet? In the left panel, press Sample army, or Import army list for your own."),
        t("When both armies are down, press Start battle ▶ at the top."),
      ],
    };
  if (game.procedure || game.attack)
    return {
      head: t("{phase}: a roll is under way", { phase }),
      lines: [t("Finish it in the panel on the right: pick the next step or roll.")],
    };
  if (game.pending)
    return {
      head: t("{phase}: a reaction", { phase }),
      lines: [t("A player can react now. The panel at the bottom right shows what.")],
    };
  // Placing dice on cards (FSD's Pre-assign, Cleanup): both players at once (UX 261).
  if (currentSlot(game)?.placeDice) {
    const slots = placeList(game, me, hotseat);
    return {
      head: t("{phase}: place dice on cards", { phase }),
      lines: [
        t(
          "Put dice from your pool on the cards that take their faces. A die on a card waits there for that action.",
        ),
        ...(slots.length
          ? [t("Cards that take dice (click one to open it):")]
          : [t("None of your cards take dice now.")]),
        t("When both players are done, press ▶ at the top."),
      ],
      units: slots,
    };
  }
  if (!mine)
    return {
      head: t("{side}'s turn · {phase}", { side: who, phase }),
      lines: [t("Waiting for {side}. You can look around, measure (M) and talk in the chat.", { side: who })],
    };

  const plain = plainActivations(game);
  const acting = plain ? actingUnits(game)[0] : undefined;
  const units = Object.values(game.units).filter(
    (u) =>
      game.players[u.owner]?.seat === side &&
      u.modelIds.some((id) => game.models[id] && !game.models[id]!.destroyed) &&
      // A unit that has had its go this round is done; one taking its go is the only one that can act (UX 329).
      (!plain || (acting ? u.id === acting.id : !u.status?.activated)),
  );
  // Each action someone on this side can take now, and how many units can.
  const can = new Map<string, number>();
  const add = (name: string) => can.set(name, (can.get(name) ?? 0) + 1);
  let outOfRange = false;
  for (const u of units)
    for (const o of unitActions(game, u.id)) {
      if (!o.ok) continue;
      // Shooting with nothing in reach is no option for a newcomer (UX 156).
      if (/shoot/i.test(o.def.name) && !inReach(game, u)) {
        outOfRange = true;
        continue;
      }
      add(gameText(o.def.name));
    }
  const mod = gameModule(game.system);
  const slot = currentSlot(game)?.id;
  if (mod?.actions?.length) {
    const view = gameView(game, mod.system.id);
    for (const a of mod.actions)
      if (a.by === "unit" && (!a.phases || (slot && a.phases.includes(slot))))
        for (const u of units) {
          const actor = { player: u.owner, unitId: u.id };
          if ((!a.applies || a.applies(view, actor)) && a.available(view, actor) === true) add(a.name);
        }
  }
  for (const u of units) for (const name of ready[u.id] ?? []) add(name);
  const lines: string[] = [];
  if (acting)
    lines.push(
      t("{unit} is taking its go: shoot or fight with it, or press End activation.", { unit: acting.name }),
    );
  else if (plain && !units.length) lines.push(t("All your units have had their go this round: press Pass."));
  // In an activation (Rift Lanterns, #42) a unit moves as part of acting, whatever the segment is called.
  const activation = turnView(game).alternating;
  if (!acting && units.length && (/move/i.test(raw) || activation || Object.keys(ready).length))
    lines.push(t("Drag a unit to move it. The ruler shows how far it has gone against its limit."));
  if (/charge/i.test(raw) && !can.size)
    lines.push(t("No unit is close enough to charge: press ▶ to move on."));
  if (activation && !can.size && !outOfRange && units.length && !acting)
    lines.push(t("Nothing is in reach to attack yet: move closer first."));
  if (outOfRange && !can.size) lines.push(t("Nothing is in range to shoot yet. Get closer next turn."));
  if (can.size)
    lines.push(
      t("You can: {actions}.", {
        actions: [...can]
          .map(([name, n]) =>
            tn(n, "{action} ({n} unit)", "{action} ({n} units)", {
              action: gameText(name).replace(/\s*\(.*\)$/, ""),
            }),
          )
          .join(", "),
      }),
      touch()
        ? t("Tap one of your units to see its buttons.")
        : t("Click one of your units to see its buttons."),
    );
  else if (!/move/i.test(raw) && !/charge/i.test(raw) && !outOfRange && !activation)
    lines.push(t("Nothing to do this phase."));
  lines.push(
    activation
      ? plain
        ? t(
            "A unit's go ends when it shoots or fights, or press End activation after a move. Pass when you have nothing left.",
          )
        : t("When a unit has acted, press End activation at the top; when you have nothing left, Pass.")
      : t("When you're done, press ▶ at the top for the next phase."),
  );
  // The mission's rule, where a player looks for what to do (UX 325).
  const mission = systemModule(game.system).missions?.find((m) => m.id === game.mission?.id);
  if (mission?.summary)
    lines.push(
      t("Mission · {name}: {summary}", { name: gameText(mission.name), summary: gameText(mission.summary) }),
    );
  return { head: t("{side}'s turn · {phase}", { side: who, phase }), lines };
}

const faces = (s: { min: number; max: number }) => (s.min === s.max ? `${s.min}` : `${s.min}–${s.max}`);

/** "Lancer Tank · Light Cannon takes 4–6" for each weapon card the player can put dice on now. */
function placeList(game: GameState, me: string | null, hotseat: boolean): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const u of Object.values(game.units)) {
    if (!hotseat && u.owner !== me) continue;
    if (!u.modelIds.some((id) => game.models[id] && !game.models[id]!.destroyed)) continue;
    for (const w of Object.values(u.sheet?.weapons ?? {})) {
      const ws = weaponSlots(game, u.id, w.id);
      if (!ws || ws.off || !ws.slots.length) continue;
      const on = game.placed?.[u.owner]?.[placedKey(u.id, w.id)]?.length ?? 0;
      const text = t("{unit} · {weapon} takes {faces}", {
        unit: u.name,
        weapon: w.name,
        faces: ws.slots.map(faces).join(", "),
      });
      out.push({ id: u.id, text: on ? `${text} ${t("(placed: {n})", { n: on })}` : text });
    }
  }
  return out;
}

/** Some enemy is within reach of one of the unit's ranged weapons (true when its weapons can't be read). */
function inReach(game: GameState, unit: Unit): boolean {
  const ranged = Object.values(unit.sheet?.weapons ?? {}).filter((w) => w.kind === "ranged");
  if (!ranged.length) return true;
  const reaches = ranged.map(weaponReach);
  if (reaches.some((r) => r === null)) return true;
  const reach = Math.max(...(reaches as number[]));
  const mine = aliveModels(game, unit);
  return Object.values(game.units).some(
    (e) => opposed(game, e.owner, unit.owner) && unitDistance(mine, aliveModels(game, e)) <= reach,
  );
}

export function WhatNow() {
  const game = useGame();
  const open = useHelp((s) => s.hint);
  const me = useStore((s) => s.session?.selfId ?? null);
  const hotseat = useStore((s) => s.mode === "hotseat");
  const spectator = useStore((s) => s.role === "spectator");
  const scrub = useStore((s) => s.scrub);
  // A lesson's coach card says what to do instead.
  const coaching = useCoach((s) => s.lesson !== null && !s.free);
  const ready = useSandbox((s) => s.app?.ready);
  // A rule's question (Overcharge?) sits where this card does, and is what to do now (PX item 4).
  const asking = !!game.script?.waiting;
  if (spectator || scrub !== null || coaching || asking) return null;
  if (!open)
    return (
      <button className="whatnow-toggle" onClick={() => useHelp.setState({ hint: true })}>
        {t("What can I do now?")}
      </button>
    );
  const { head, lines, units } = whatNow(game, me, hotseat, ready);
  return (
    <div className="panel whatnow">
      <div className="row spread">
        <strong>{head}</strong>
        <button className="quiet" title={t("Hide")} onClick={() => useHelp.setState({ hint: false })}>
          ✕
        </button>
      </div>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {units && units.length > 0 && (
        <ul className="whatnow-cards">
          {units.map((u) => (
            <li key={u.text}>
              <button className="link" onClick={() => useStore.getState().select(u.id)}>
                {u.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        {t("Press")} <kbd>?</kbd> {t("for all the controls.")}
      </p>
    </div>
  );
}
