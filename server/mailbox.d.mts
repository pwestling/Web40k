// Types for server/mailbox.mjs, for its tests (server/mailbox.test.ts).
import type { Server } from "node:http";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function vapidKeys(): VapidKeys;
export function vapidAuth(endpoint: string, keys: VapidKeys, subject: string, now?: number): string;
export function createMailbox(options?: {
  dataDir?: string;
  ttlDays?: number;
  maxFileBytes?: number;
  vapid?: VapidKeys | null;
  subject?: string;
  push?: ((subscription: { endpoint: string }) => Promise<number>) | null;
}): { server: Server; sweep: (now?: number) => Promise<number> };
