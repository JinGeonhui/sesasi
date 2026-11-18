import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createTransitProvider, TransitError } from "./provider.mjs";
import { createWeatherProvider, WeatherProviderError } from "./weather.mjs";

export function createTransitServer({ serviceKey, allowedOrigins = [] } = {}, provider = createTransitProvider(serviceKey), weather = createWeatherProvider()) {
  const origins = new Set(allowedOrigins);
  let active = 0;
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = typeof origin === "string" && origins.has(origin);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    if (allowed) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS" });
    const send = (status, body) => { res.writeHead(status, headers); res.end(JSON.stringify(body)); };
    if (!allowed) return send(403, { code: "ORIGIN_DENIED" });
    if (req.method === "OPTIONS") return send(204, {});
    if (req.method !== "GET") return send(405, { code: "METHOD_NOT_ALLOWED" });
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/v1/status") return send(200, { ready: provider.ready });
    if (["/v1/weather", "/v1/air"].includes(url.pathname)) {
      if ([...url.searchParams.keys()].some(key => key !== "city") || url.searchParams.getAll("city").length !== 1) return send(400, { code: "INVALID_REQUEST" });
      if (active >= 8) return send(429, { code: "BUSY" });
      active++;
      try { send(200, await weather.read(url.pathname.slice(4), url.searchParams.get("city"))); }
      catch (error) {
        const code = error instanceof WeatherProviderError ? error.code : "WEATHER_UNAVAILABLE";
        if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
        headers["Access-Control-Expose-Headers"] = "Retry-After";
        send(code === "INVALID_REQUEST" ? 400 : code === "WEATHER_RATE_LIMITED" ? 429 : code === "WEATHER_TIMEOUT" ? 504 : 502, { code });
      } finally { active--; }
      return;
    }
    const routes = {
      "/v1/cities": { fields: [], run: () => provider.cities() },
      "/v1/buses": { fields: ["city", "q"], run: () => provider.buses(url.searchParams.get("city"), url.searchParams.get("q")) },
      "/v1/stops": { fields: ["city", "route"], run: () => provider.stops(url.searchParams.get("city"), url.searchParams.get("route")) },
      "/v1/rail": { fields: [], run: () => provider.rail() },
      "/v1/stations": { fields: ["city", "q"], run: () => provider.stations(url.searchParams.get("city"), url.searchParams.get("q")) },
      "/v1/connections": { fields: ["city", "from", "to"], run: () => provider.connections(url.searchParams.get("city"), url.searchParams.get("from"), url.searchParams.get("to")) },
      "/v1/arrivals": { fields: ["city", "node", "route"], run: () => provider.arrivals(url.searchParams.get("city"), url.searchParams.get("node"), url.searchParams.get("route")) },
      "/v1/station-arrivals": { fields: ["city", "node"], run: () => provider.arrivals(url.searchParams.get("city"), url.searchParams.get("node")) },
    };
    const operation = routes[url.pathname];
    if (!operation) return send(404, { code: "NOT_FOUND" });
    if (!provider.ready) return send(503, { code: "SETUP_REQUIRED" });
    const params = url.searchParams;
    if ([...params.keys()].some(key => !operation.fields.includes(key) || params.getAll(key).length !== 1)
      || operation.fields.some(key => !params.get(key)?.trim() || params.get(key).length > 60)
      || (params.has("city") && !/^\d{1,9}$/.test(params.get("city")))
      || ["route", "from", "to", "node"].some(key => params.has(key) && !/^[\w-]{1,60}$/.test(params.get(key)))) return send(400, { code: "INVALID_REQUEST" });
    if (active >= 8) return send(429, { code: "BUSY" });
    active++;
    try { send(200, { items: await operation.run() }); }
    catch (error) { send(502, { code: error instanceof TransitError ? error.code : "PROVIDER_UNAVAILABLE" }); }
    finally { active--; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createTransitServer({
    serviceKey: process.env.TAGO_SERVICE_KEY,
    allowedOrigins: (process.env.TRANSIT_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map(value => value.trim()).filter(Boolean),
  });
  server.listen(Number(process.env.TRANSIT_PORT ?? 4191), "127.0.0.1", () => {
    console.log(`Transit API listening on 127.0.0.1:${server.address().port} (${process.env.TAGO_SERVICE_KEY ? "configured" : "key required"}).`);
  });
}
