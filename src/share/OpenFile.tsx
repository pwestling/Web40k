import { useState } from "react";
import { t } from "../i18n";
import { openBytes, sharedKind } from "./links";
import { openTts } from "../figures/open";

/**
 * "Open a file…" (UX 83): one button for every file Open Battle saves (a
 * replay, an army or Yellowscribe list, a table, a figure pack, a standee),
 * recognised by what's inside, and opened where it belongs.
 */
export function OpenFile() {
  const [note, setNote] = useState("");
  const open = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let data: unknown = null;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Not JSON: nothing here opens it.
    }
    const kind = sharedKind(data);
    // A Tabletop Simulator save opens in the TTS import, already loaded (UX 503).
    if (!kind && (data as { ObjectStates?: unknown } | null)?.ObjectStates) {
      setNote("");
      return openTts(file);
    }
    if (!kind) return setNote(t("That isn't a file Open Battle saves."));
    const name = file.name.replace(/\.(army|table|figures)?\.?(json|standee)$/i, "");
    setNote((await openBytes(kind, name, bytes)) ?? t("That file couldn't be opened."));
  };
  return (
    <>
      <label
        className="file"
        title={t("A replay, army, Yellowscribe list, table, figure pack or standee saved from Open Battle")}
      >
        {t("Open a file…")}
        <input
          type="file"
          accept=".json,.standee,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void open(file);
          }}
        />
      </label>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </>
  );
}
