/**
 * Games hosted by a host server (server/host.mjs) rather than a player's
 * browser. The site's config.json names the server (netConfig().hostServer).
 */

/** What the lobby asks the server to set up. */
interface ServedGame {
  room: string;
  system: string;
  teamSize?: number;
}

const base = (server: string) => server.replace(/\/+$/, "");

/** Ask the host server to host a new game in `game.room`. Throws with the server's reason. */
export async function openServed(server: string, game: ServedGame): Promise<void> {
  const res = await fetch(`${base(server)}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(game),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `the host server answered ${res.status}`);
}

/**
 * Whether the server hosts `room`, bringing it back into a room it left while
 * the room stood empty. False when it doesn't, or can't be reached.
 */
export async function wakeServed(server: string, room: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(server)}/rooms/${encodeURIComponent(room)}/wake`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
