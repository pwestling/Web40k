import { opposed, sideName, type GameState, type Unit } from "../core";
import { aliveModels, unitDistance, weaponReach } from "../systems/wh40k/rules";
import { unitActions } from "../core/content/play";
import { currentSlot, phaseName, turnView } from "../core/content/turn";
import { gameView } from "../core/script";
import { useStore } from "../store";
import { gameModule } from "../systems";
import { useHelp } from "./help";
import { useCoach } from "../teach/store";
import { useGame } from "./hooks";
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
): { head: string; lines: string[] } {
  const phase = phaseName(game) ?? "";
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
  if (!mine)
    return {
      head: t("{side}'s turn · {phase}", { side: who, phase }),
      lines: [t("Waiting for {side}. You can look around, measure (M) and talk in the chat.", { side: who })],
    };

  const units = Object.values(game.units).filter(
    (u) =>
      game.players[u.owner]?.seat === side &&
      u.modelIds.some((id) => game.models[id] && !game.models[id]!.destroyed),
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
  const lines: string[] = [];
  if (/move/i.test(phase))
    lines.push(t("Drag a unit to move it. The ruler shows how far it has gone against its limit."));
  if (/charge/i.test(phase) && !can.size)
    lines.push(t("No unit is close enough to charge: press ▶ to move on."));
  if (outOfRange && !can.size) lines.push(t("Nothing is in range to shoot yet. Get closer next turn."));
  if (can.size)
    lines.push(
      t("You can: {actions}.", {
        actions: [...can]
          .map(([name, n]) =>
            tn(n, "{action} ({n} unit)", "{action} ({n} units)", { action: name.replace(/\s*\(.*\)$/, "") }),
          )
          .join(", "),
      }),
      t("Click one of your units to see its buttons."),
    );
  else if (!/move/i.test(phase) && !/charge/i.test(phase) && !outOfRange)
    lines.push(t("Nothing to do this phase."));
  lines.push(
    turnView(game).alternating
      ? t("When a unit has acted, press End activation at the top; when you have nothing left, Pass.")
      : t("When you're done, press ▶ at the top for the next phase."),
  );
  return { head: t("{side}'s turn · {phase}", { side: who, phase }), lines };
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
  if (spectator || scrub !== null || coaching) return null;
  if (!open)
    return (
      <button className="whatnow-toggle" onClick={() => useHelp.setState({ hint: true })}>
        {t("What can I do now?")}
      </button>
    );
  const { head, lines } = whatNow(game, me, hotseat);
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
      <p className="muted small">
        {t("Press")} <kbd>?</kbd> {t("for all the controls.")}
      </p>
    </div>
  );
}
