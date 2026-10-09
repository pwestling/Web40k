/**
 * A standee's file (#68): the cut-out photos and the base they were scaled
 * to, as the player keeps it. Like a model file, its SHA-256 is the figure's
 * identity, so the library, the shelf and peer sharing treat it like any
 * other upload.
 */

export const STANDEE_EXTENSION = ".standee";
const FORMAT = "open-battle/standee@1";

interface StandeeFile {
  format: typeof FORMAT;
  name: string;
  /** The base's width in the photo, in its pixels, and in millimetres: the photo's scale. */
  basePx: number;
  baseMm: number;
  /** The front photo, cut out (transparent outside the miniature), as a data URL. */
  front: string;
  /** The back photo, cut out, if the player took one. */
  back?: string;
}

export function standeeBytes(file: Omit<StandeeFile, "format">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ format: FORMAT, ...file }));
}

const image = (s: unknown) => typeof s === "string" && /^data:image\/(webp|png|jpeg);base64,/.test(s);

export function readStandee(bytes: ArrayBuffer | Uint8Array): StandeeFile | null {
  try {
    const f = JSON.parse(new TextDecoder().decode(bytes)) as Partial<StandeeFile>;
    if (f.format !== FORMAT || !image(f.front) || (f.back !== undefined && !image(f.back))) return null;
    if (!(Number(f.basePx) > 0) || !(Number(f.baseMm) > 0) || typeof f.name !== "string") return null;
    return f as StandeeFile;
  } catch {
    return null;
  }
}
