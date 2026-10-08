/**
 * Where to play, for what leaves the app (cards, clips): this site's address
 * when it is served from somewhere real, else the project's public one (a
 * replay page opened from disk, a dev server).
 */
const PUBLIC = "pwestling.github.io/Web40k";

export function siteUrl(): string {
  const { protocol, hostname, host, pathname } = location;
  if (!protocol.startsWith("http") || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(hostname)) return PUBLIC;
  return `${host}${pathname.replace(/[^/]*$/, "")}`.replace(/\/$/, "");
}
