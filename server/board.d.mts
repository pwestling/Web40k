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

/** Whether a ranked result's signatures hold (both players', or the signer's and the decliner's). */
export function signaturesHold(r: unknown): Promise<boolean>;
