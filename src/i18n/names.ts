import { t } from ".";

/**
 * A player's name as shown here. The default seat names ("Player 1") are
 * stored in English, the same on every device, and shown in this device's
 * language (UX 257); names players chose are shown as they wrote them.
 */
export function displayName(name: string): string {
  const seat = /^Player (\d+)$/.exec(name)?.[1];
  return seat ? t("Player {n}", { n: seat }) : name;
}

/** `displayName` of a player who may not be there. */
export function playerName(p: { name: string } | undefined): string | undefined {
  return p && displayName(p.name);
}
