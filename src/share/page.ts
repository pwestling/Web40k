import type { GameRecord } from "../core";
import { t } from "../i18n";
import { bundleReplay } from "../ui/replayFile";
import { replayIntro } from "../ui/highlights";
import { pack } from "../viewer/pack";
import { saveFile, stamp } from "./cards";

/**
 * The replay as one web page (#46): the viewer page the build made
 * (vite.config.ts replayViewer) with this replay, its figures, terrain models,
 * rules packages and notes packed into it. It opens in any browser, offline,
 * from a disk or a forum attachment.
 */
export async function exportPage(record: GameRecord): Promise<void> {
  const res = await fetch(new URL("viewer.html", document.baseURI)).catch(() => null);
  if (!res?.ok) throw new Error(t("Making the replay page needs a connection."));
  const html = await res.text();
  const data = await pack(JSON.stringify(await bundleReplay(record)));
  const intro = replayIntro(record);
  const title = intro.players.map((p) => p.name).join(" vs ") || "Open Battle replay"; // i18n-ignore
  const page = html
    .replace("<!--REPLAY-->", data)
    .replace("<title>Open Battle replay</title>", `<title>${escape(title)} · Open Battle</title>`);
  saveFile(new Blob([page], { type: "text/html" }), `${stamp()}.html`);
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
