import { APP_BUILD } from "./version";

/**
 * The network protocol (docs/compatibility.md): the shape of events, intents
 * and peer messages. Two builds with the same number can play together;
 * bump it, through a proposal (GOVERNANCE.md), when that stops being true.
 */
export const PROTOCOL = 1;

/** What a peer says about its code when it greets another. */
export interface BuildInfo {
  protocol: number;
  build: string;
}

export const MY_BUILD: BuildInfo = { protocol: PROTOCOL, build: APP_BUILD };

/** A peer's build info, if the message carried some that reads right. */
export function buildInfo(raw: unknown): BuildInfo | undefined {
  const v = raw as Partial<BuildInfo> | null;
  return v && Number.isInteger(v.protocol) && typeof v.build === "string" && v.build.length <= 80
    ? { protocol: v.protocol!, build: v.build }
    : undefined;
}
