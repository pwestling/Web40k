import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameScreen } from "../GameScreen";
import { useAssets } from "../assets/store";
import { fromBase64 } from "../assets/base64";
import { useLibrary } from "../packages/library";
import { carryNotes, cleanNotes } from "../replay/notes";
import type { ReplayFile } from "../ui/replayFile";
import { useStore } from "../store";
import { CrashGuard } from "../ui/Crash";
import { unpack } from "./pack";
import "../styles.css";

/**
 * The replay page (#46): one HTML file holding this viewer, the replay and
 * everything it needs (figures, terrain models, rules packages), made by
 * Share the battle → Download the replay page. It opens from a disk or a
 * forum attachment with no server: nothing here touches the network. The
 * replay is in the page as gzipped base64 (`#open-battle-replay`).
 *
 * The packages it carries run, sandboxed as in the app: whoever made the page
 * chose to share them, and the page is itself code from them.
 */
async function main() {
  const root = document.getElementById("root")!;
  const data = document.getElementById("open-battle-replay")?.textContent?.trim();
  if (!data) {
    root.textContent = "This page has no replay in it."; // i18n-ignore
    return;
  }
  const { attachments, annotations, ...record } = JSON.parse(await unpack(data)) as ReplayFile;
  carryNotes(record, cleanNotes(annotations));
  const { decodeAsset } = await import("../assets/codec");
  for (const [id, bytes] of Object.entries(attachments?.assets ?? {})) {
    try {
      useAssets.getState().addAsset({ ...(await decodeAsset(fromBase64(bytes))), id });
    } catch {
      // A damaged figure: the model shows its plain stand-in.
    }
  }
  const library = useLibrary.getState();
  for (const [hash, source] of Object.entries(attachments?.packages ?? {})) {
    const added = await library.add(new TextEncoder().encode(source), { expect: hash });
    if (added.ok) useLibrary.getState().trust(hash, true);
  }
  useStore.getState().openReplay(record);
  // The whole table first; the camera follows the action once they press play (UX 344).
  useStore.getState().set({ director: false });
  createRoot(root).render(
    <StrictMode>
      <CrashGuard>
        <GameScreen started />
      </CrashGuard>
    </StrictMode>,
  );
}

void main();
