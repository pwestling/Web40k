import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { SideMessage } from "../net/transport";
import { useShelf } from "../packages/shelf";
import { useStore } from "../store";
import { deployShelfArmy, useDeployed } from "../ui/shelfActions";

/** Offers made in this game, by player and army, so a "No thanks" isn't asked again. */
const offered = new Set<string>();

/**
 * An army brought for the guest (UX 481). Most TTS tables hold both armies,
 * and the host has both on their shelf: when a player sits down on a side
 * whose army came from this table, the host offers it to them, and on "Use
 * it" puts it on the table for them, figures and all. No file round trip.
 */
export function BroughtOffer() {
  const session = useStore((s) => s.session);
  const role = useStore((s) => s.role);
  const [offer, setOffer] = useState<{
    id: string;
    name: string;
    units: string[];
    by?: string;
    from: string;
  } | null>(null);

  // The host: offer each newly seated player the army brought for their side.
  useEffect(() => {
    if (!session || role !== "host") return;
    void useShelf.getState().load();
    const check = () => {
      const { game } = useStore.getState();
      const key = game.tableSource?.key;
      if (!key?.startsWith("table:") || game.turn.round > 0) return;
      const table = key.slice("table:".length);
      const taken = new Set(Object.values(useDeployed.getState()).map((d) => d.shelfId));
      for (const p of Object.values(game.players)) {
        if (p.id === session.selfId || typeof p.seat !== "number") continue;
        if (Object.values(game.units).some((u) => u.owner === p.id)) continue;
        const side = p.seat === 0 ? 0 : 1;
        const army = Object.values(useShelf.getState().armies).find(
          (a) => a.from?.table === table && a.from.side === side && !taken.has(a.id),
        );
        if (!army || offered.has(`${p.id}:${army.id}`)) continue;
        offered.add(`${p.id}:${army.id}`);
        const me = game.players[session.selfId];
        session.sendSide(
          {
            t: "army/offer",
            id: army.id,
            name: army.name,
            units: army.roster.units.map((u) => u.name),
            ...(me?.name ? { by: me.name } : {}),
          },
          p.id,
        );
      }
    };
    check();
    const offStore = useStore.subscribe((s, was) => {
      if (s.game.players !== was.game.players || s.game.tableSource !== was.game.tableSource) check();
    });
    const offShelf = useShelf.subscribe(check);
    return () => {
      offStore();
      offShelf();
    };
  }, [session, role]);

  // Both ends of the conversation.
  useEffect(() => {
    if (!session) return;
    session.listenSide(
      (message: SideMessage, from: string) => {
        if (message.t === "army/offer" && role !== "host") {
          setOffer({
            id: message.id,
            name: message.name,
            units: message.units.slice(0, 12),
            by: message.by,
            from,
          });
        } else if (message.t === "army/take" && role === "host") {
          const { game } = useStore.getState();
          const army = useShelf.getState().armies[message.id];
          if (!army || !game.players[from] || !offered.has(`${from}:${army.id}`)) return;
          if (Object.values(game.units).some((u) => u.owner === from)) return;
          deployShelfArmy(army, from, (intent, as) => session.dispatch(intent, as));
        }
      },
      null,
      "brought",
    );
    return () => session.listenSide(null, null, "brought");
  }, [session, role]);

  if (!offer || !session) return null;
  const units = offer.units.length > 4 ? [...offer.units.slice(0, 4), "…"] : offer.units;
  return (
    <div className="brought-offer small" role="status">
      <span>
        {t("{name} brought an army for you: {units}. Use it?", {
          name: offer.by || t("The host"),
          units: units.join(", "),
        })}
      </span>
      <span className="row">
        <button
          className="primary small"
          onClick={() => {
            session.sendSide({ t: "army/take", id: offer.id }, offer.from);
            setOffer(null);
          }}
        >
          {t("Use this army")}
        </button>
        <button className="quiet small" onClick={() => setOffer(null)}>
          {t("No thanks")}
        </button>
      </span>
    </div>
  );
}
