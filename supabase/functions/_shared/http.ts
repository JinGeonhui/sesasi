export type Environment = (key: string) => string | undefined;
export class HttpError extends Error {
  status: number;
  code: string;
  retryAfter: number;
  constructor(status: number, code: string, retryAfter = 0) { super(code); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
export type Identity = { id: string; email?: string; confirmed: boolean };
export type Authenticate = (token: string) => Promise<Identity | null>;
export function protectedHandler(env: Environment, authenticate: Authenticate, run: (req: Request, user: Identity) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowed = (env('SESASI_ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim());
    const headers: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin && !allowed.includes(origin)) return Response.json({ code: 'ORIGIN_DENIED' }, { status: 403, headers });
    if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-region', 'Access-Control-Expose-Headers': 'Retry-After' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let response: Response;
    try {
      if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const owner = env('SESASI_OWNER_EMAIL')?.trim().toLowerCase();
      if (!owner) throw new HttpError(503, 'SETUP_REQUIRED');
      const match = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i);
      if (!match) throw new HttpError(401, 'LOGIN_REQUIRED');
      const user = await authenticate(match[1]);
      if (!user) throw new HttpError(401, 'LOGIN_REQUIRED');
      if (!user.confirmed || user.email?.trim().toLowerCase() !== owner) throw new HttpError(403, 'OWNER_REQUIRED');
      response = await run(req, user);
    } catch (error) {
      const known = error instanceof HttpError;
      response = Response.json({ code: known ? error.code : 'SERVER_UNAVAILABLE' }, { status: known ? error.status : 502 });
      if (known && error.retryAfter) response.headers.set('Retry-After', String(error.retryAfter));
    }
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  };
}
export function fields(url: URL, names: string[]) {
  if ([...url.searchParams.keys()].some(key => !names.includes(key)) || names.some(key => url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)?.trim() || url.searchParams.get(key)!.length > 80)) throw new HttpError(400, 'INVALID_REQUEST');
  return Object.fromEntries(names.map(key => [key, url.searchParams.get(key)!]));
}
export async function jsonBody(req: Request, max = 2_000_000): Promise<unknown> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'INVALID_REQUEST');
  if (!req.body || Number(req.headers.get('content-length')) > max) throw new HttpError(413, 'INVALID_REQUEST');
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new HttpError(413, 'INVALID_REQUEST'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(joined)); } catch { throw new HttpError(400, 'INVALID_REQUEST'); }
}
