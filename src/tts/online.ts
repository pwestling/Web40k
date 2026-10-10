import { t } from "../i18n";
import { NET_PARAMS } from "../net/config";
import { useStore } from "../store";
import { applyLayout } from "../tables/actions";
import { presetMission } from "../ui/demo";
import { deployShelfArmy } from "../ui/shelfActions";
import type { BroughtTable } from "./bring";
import { useTtsNote } from "./TtsNote";

/**
 * "Play it online with a friend" (UX 482): host a game on the save's table
 * with Player 1's army where it stood, and the invite link copied. Player 2's
 * army waits on the shelf; the guest who sits on that side is offered it
 * (BroughtOffer). Resolves with whether the link reached the clipboard.
 */
export function hostTtsOnline(brought: BroughtTable, note = ""): Promise<boolean> {
  const here = new URLSearchParams(location.search);
  const roomId = crypto.randomUUID().slice(0, 8);
  const q = new URLSearchParams({ room: roomId });
  const local = here.get("local") === "1";
  if (local) q.set("local", "1");
  for (const k of NET_PARAMS) if (here.get(k)) q.set(k, here.get(k)!);
  history.replaceState(null, "", `?${q}`);
  const name = localStorage.getItem("open-battle:name") ?? "";
  const system = brought.table.system;
  useStore.getState().start({ role: "host", mode: local ? "local" : "online", roomId, name, system });
  const copied = navigator.clipboard?.writeText(location.href).then(
    () => true,
    () => false,
  );
  return new Promise((resolve) => {
    const go = async () => {
      // The mission first: the save's table keeps its own zones (short edges, UX 480).
      presetMission();
      await applyLayout(brought.table.layout, { key: `table:${brought.table.id}`, name: brought.table.name });
      const linked = (await copied) ?? false;
      useTtsNote.setState({
        table: brought.table.id,
        note: [
          linked
            ? t(
                "Invite link copied: send it to your friend. The army brought for them is offered when they sit down.",
              )
            : t(
                "Send your friend the invite link (Copy invite link). The army brought for them is offered when they sit down.",
              ),
          note,
        ]
          .filter(Boolean)
          .join(" "),
      });
      const self = useStore.getState().session?.selfId;
      const mine = brought.armies.find((a) => a.side === 0)?.army;
      if (self && mine && useStore.getState().game.players[self]) deployShelfArmy(mine, self);
      resolve(linked);
    };
    // Online, the session starts once WebRTC has loaded.
    if (useStore.getState().session) return void go();
    const off = useStore.subscribe((s) => {
      if (!s.session || !s.game.players[s.session.selfId]) return;
      off();
      void go();
    });
  });
}
