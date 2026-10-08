import type { IncomingMessage, ServerResponse } from "node:http";

export interface Board {
  /** Answer a board request; false when the path isn't the board's. */
  handle(
    req: Pick<IncomingMessage, "method"> | NodeJS.ReadableStream,
    res: Pick<ServerResponse, "writeHead" | "end"> | { writeHead(s: number): void; end(t: string): void },
    path: string,
    from: string,
  ): Promise<boolean>;
  size(): number;
}

export function createBoard(options?: { now?: () => number }): Board;
