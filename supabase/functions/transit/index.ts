import { env, authenticate } from '../_shared/runtime.ts';
import { fields, HttpError, protectedHandler } from '../_shared/http.ts';
import { createTransitProvider, TransitError } from '../_shared/transit-provider.ts';
const api = createTransitProvider(env('TAGO_SERVICE_KEY'));
const routes: Record<string, { fields: string[]; run: (p: Record<string, string>) => Promise<unknown> }> = {
  cities: { fields: [], run: () => api.cities() },
  buses: { fields: ['city', 'q'], run: p => api.buses(p.city, p.q) },
  stops: { fields: ['city', 'route'], run: p => api.stops(p.city, p.route) },
  rail: { fields: [], run: () => api.rail() },
  stations: { fields: ['city', 'q'], run: p => api.stations(p.city, p.q) },
  connections: { fields: ['city', 'from', 'to'], run: p => api.connections(p.city, p.from, p.to) },
  arrivals: { fields: ['city', 'node', 'route'], run: p => api.arrivals(p.city, p.node, p.route) },
  'station-arrivals': { fields: ['city', 'node'], run: p => api.arrivals(p.city, p.node) },
};
Deno.serve(protectedHandler(env, authenticate, async req => {
  if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
  const url = new URL(req.url), path = url.searchParams.get('path') ?? '';
  const route = Object.hasOwn(routes, path) ? routes[path] : null;
  if (!route) throw new HttpError(404, 'NOT_FOUND');
  const p = fields(url, ['path', ...route.fields]);
  if ((p.city && !/^\d{1,9}$/.test(p.city)) || ['route', 'from', 'to', 'node'].some(key => p[key] && !/^[\w-]{1,60}$/.test(p[key]))) throw new HttpError(400, 'INVALID_REQUEST');
  if (!api.ready) throw new HttpError(503, 'SETUP_REQUIRED');
  try { return Response.json({ items: await route.run(p) }); }
  catch (error) { throw new HttpError(502, error instanceof TransitError ? error.code : 'PROVIDER_UNAVAILABLE'); }
}));
