import { readManifest, type Manifest } from "../packages/manifest";

/** A package being written in the workshop, kept in this browser. */
export interface Draft {
  id: string;
  source: string;
  updated: number;
  /** The hash it was last saved to the package library as. */
  saved?: string;
}

const KEY = "open-battle:workshop";

export function loadDrafts(): { drafts: Draft[]; current: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
      drafts: Draft[];
      current: string | null;
    } | null;
    if (raw && Array.isArray(raw.drafts)) return raw;
  } catch {
    // Storage off or unreadable: start empty.
  }
  return { drafts: [], current: null };
}

export function storeDrafts(drafts: Draft[], current: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ drafts, current }));
  } catch {
    // Private mode or full: the drafts last until the page closes.
  }
}

export function newDraft(source: string): Draft {
  return { id: crypto.randomUUID().slice(0, 8), source, updated: Date.now() };
}

/** A draft's manifest, or why it can't be read. */
export function manifestOf(source: string): Manifest | string {
  const r = readManifest(source);
  return "error" in r ? r.error : r.manifest;
}

/** Things to fix before a draft can run as a whole game. */
export function problems(source: string): string[] {
  const m = manifestOf(source);
  if (typeof m === "string") return [m];
  const out: string[] = [];
  if (m.kind !== "system") out.push('The workshop tests whole games: set manifest.kind to "system".');
  if (!m.systems[0]) out.push("Name the game's system id in manifest.systems.");
  if (!/export\s+default\b/.test(source)) out.push("Export the game: export default { module }.");
  return out;
}

/** A file name for a draft's download: its id and version. */
export function fileName(m: Manifest): string {
  return `${m.id.replace(/[^\w.-]+/g, "-")}-${m.version}.js`;
}

const REPO = "https://github.com/pwestling/Web40k";
export const GALLERY = `${REPO}/blob/main/docs/community-modules.md`;
export const GALLERY_EDIT = `${REPO}/edit/main/docs/community-modules.md`;

/**
 * A pull request's text for listing a module in the community gallery
 * (docs/community-modules.md): the gallery's table row and what reviewers
 * check. The module itself lives at `url`, wherever its author hosts it.
 */
export function prText(m: Manifest, hash: string, url: string): string {
  const where = url || "<the module's raw URL>";
  return [
    `## Add ${m.name} ${m.version} to the community modules`,
    "",
    m.adds ?? "",
    "",
    "Row for docs/community-modules.md:",
    "",
    "```",
    `| [${m.name}](${where}) | ${m.version} | ${m.author ?? ""} | ${m.systems.join(", ")} | ${m.adds ?? ""} | \`${hash.slice(0, 16)}\` |`,
    "```",
    "",
    `- Package id: \`${m.id}\` (kind: ${m.kind})`,
    `- SHA-256: \`${hash}\``,
    "- Tested in the module workshop: the test table and the soak bot.",
    "- No Games Workshop text, names or stats in the file.",
  ].join("\n");
}
