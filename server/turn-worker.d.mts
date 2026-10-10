export function turnServers(body: unknown): { urls: string[]; username: string; credential: string }[];
export function handle(
  request: Request,
  env: Record<string, string | undefined>,
  fetcher?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Response>;
declare const worker: { fetch(request: Request, env: Record<string, string | undefined>): Promise<Response> };
export default worker;
