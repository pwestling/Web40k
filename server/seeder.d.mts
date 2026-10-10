// Types for server/seeder.mjs, for its tests (server/seeder.test.ts).
import type { Server } from "node:http";

export function createSeeder(options?: {
  dataDir?: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  ttlDays?: number;
  contact?: string;
  adminToken?: string;
}): { server: Server; sweep: (now?: number, room?: number) => Promise<number> };
