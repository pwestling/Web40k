/**
 * Files the app hands the player (#48): one way to save one, so every
 * download is named, typed and cleaned up the same. The object URL lives a
 * while after the click: revoking it at once can cancel the save in some
 * browsers.
 */

/** Save a file the browser's way. */
export function saveFile(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Save any JSON as a file; returns its name. */
export function saveJson(name: string, data: unknown): string {
  saveFile(new Blob([JSON.stringify(data)], { type: "application/json" }), name);
  return name;
}

/** "My Army!" → "My-Army.army.json": a name safe on any system, `fallback` when nothing's left. */
export function safeFileName(name: string, fallback: string, ext: string): string {
  const base =
    name
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || fallback;
  return `${base}${ext}`;
}
