import type { DiceSet, Player } from "../core";

/**
 * Players' own dice (PX-5b): a few presets, a custom body and pip colour, and
 * four finishes the tray draws in CSS. The choice is stored on the player in
 * the game log, so everyone (and every replay) sees each player's dice.
 */

export const FINISHES: { id: DiceSet["finish"]; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "translucent", label: "Translucent" },
  { id: "marbled", label: "Marbled" },
  { id: "metallic", label: "Metallic" },
];

/** Presets, after "Player colour" (no set: dice in the player's colour, as before). */
export const PRESETS: { name: string; dice: DiceSet }[] = [
  { name: "Bone & black", dice: { body: "#e6dcc3", pip: "#1a1a1a", finish: "solid" } },
  { name: "Blood red & white", dice: { body: "#8f1d1d", pip: "#ffffff", finish: "solid" } },
  { name: "Gunmetal & gold", dice: { body: "#4b5563", pip: "#e0b354", finish: "metallic" } },
  { name: "Obsidian & brass", dice: { body: "#16181d", pip: "#c9a24a", finish: "solid" } },
  { name: "Translucent blue", dice: { body: "#2f6fd6", pip: "#ffffff", finish: "translucent" } },
  { name: "Marbled green", dice: { body: "#1f6b3a", pip: "#f4f1e8", finish: "marbled" } },
  { name: "Ivory & red", dice: { body: "#f3eee0", pip: "#b42323", finish: "solid" } },
];

const DEFAULT_PIP = "#10141a";

/** How a roller's dice look: their own set, or their colour with dark pips. */
export function diceLook(player: Pick<Player, "color" | "dice"> | undefined, fallback: string): DiceSet {
  if (player?.dice) return { ...player.dice, pip: readablePip(player.dice.body, player.dice.pip) };
  return { body: player?.color ?? fallback, pip: DEFAULT_PIP, finish: "solid" };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG contrast between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Pips that can be read on the body: the chosen colour, or black or white when it's too close. */
export function readablePip(body: string, pip: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(body) || !/^#[0-9a-f]{6}$/i.test(pip)) return DEFAULT_PIP;
  if (contrast(body, pip) >= 3) return pip;
  return contrast(body, "#000000") >= contrast(body, "#ffffff") ? "#111111" : "#ffffff";
}
