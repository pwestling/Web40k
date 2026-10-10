// Types for server/host.mjs, for its tests (server/host.test.ts).
import type { Server } from "node:http";

type Result = { ok: true; room: string; resumed?: boolean } | { ok: false; status: number; error: string };

export function createHostApi(options: {
  hosts: {
    rooms: string[];
    open(req: { room: string; system?: string; teamSize?: number }): Result;
    wake(room: string): Result;
    hosts(room: string): boolean;
  };
  build?: string;
  maxRooms?: number;
  now?: () => number;
}): { server: Server };

export function fileStore(dir: string): {
  load(room: string): unknown;
  save(room: string, record: unknown): void;
  remove(room: string): void;
  list(): { room: string; savedAt: number }[];
};
