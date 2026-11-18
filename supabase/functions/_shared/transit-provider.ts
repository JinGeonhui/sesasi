// Server-only TAGO adapter. Never include credentials or raw provider errors in responses.
export class TransitError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const text = (value: unknown) => value == null ? "" : String(value).trim();
const required = (value: unknown) => { const result = text(value); if (!result) throw new TransitError("INVALID_RESPONSE"); return result; };
const number = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new TransitError("INVALID_RESPONSE"); return n; };

function railLineName(name: string, stationId: string) {
  if (!/^\d+호선$/.test(name)) return name;
  // TAGO reuses numbered line names across cities. Metro/Korail sections
  // within the capital region must still remain on the same line.
  const operator = stationId.match(/^MTR([A-Z]+)/)?.[1] ?? "미확인";
  const regions: Record<string, string> = { GJ: "광주", BS: "부산", DG: "대구", DJ: "대전", KR: "수도권", S: "수도권", IC: "수도권", NU: "수도권", GU: "수도권" };
  const region = regions[operator];
  return region ? `${region} ${name}` : `${name} (${operator})`;
}

type Row = Record<string, unknown>;
export function unpack(payload: { response?: unknown; header?: unknown; body?: unknown }) {
  const response = (payload?.response ?? payload) as { header?: { resultCode?: unknown }; body?: { items?: { item?: unknown }; totalCount?: unknown } };
  const code = text(response?.header?.resultCode);
  if (["03", "3"].includes(code)) return { items: [], total: 0 };
  if (!["00", "0"].includes(code)) {
    throw new TransitError(["20", "21", "30", "31", "32"].includes(code ?? "") ? "AUTH_REQUIRED" : code === "22" ? "QUOTA_EXCEEDED" : "PROVIDER_ERROR");
  }
  if (!response.body) throw new TransitError("INVALID_RESPONSE");
  const item = response.body.items?.item;
  const items: Row[] = item == null || item === "" ? [] : Array.isArray(item) ? item : [item as Row];
  if (items.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new TransitError("INVALID_RESPONSE");
  const total = response.body.totalCount == null ? items.length : number(response.body.totalCount);
  if (total > 0 && !items.length) throw new TransitError("INVALID_RESPONSE");
  return { items, total };
}

export function createTransitProvider(serviceKey: string | undefined, fetcher = fetch) {
  let key = text(serviceKey);
  // Both portal key formats are accepted; URLSearchParams encodes exactly once.
  if (/%[0-9a-f]{2}/i.test(key)) { try { key = decodeURIComponent(key); } catch { throw new TransitError("AUTH_REQUIRED"); } }
  const cache = new Map<string, { expires: number; value: Row[] }>(), pending = new Map<string, Promise<Row[]>>();
  async function all(service: string, operation: string, query: Record<string, string> = {}, ttl = 30 * 60 * 1000) {
    if (!key) throw new TransitError("SETUP_REQUIRED");
    const cacheKey = JSON.stringify([service, operation, query]);
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(cacheKey)) return pending.get(cacheKey)!;
    const load = async () => {
      const result: Row[] = [];
      for (let page = 1; page <= 100; page++) {
        const url = new URL(`https://apis.data.go.kr/1613000/${service}/${operation}`);
        url.search = new URLSearchParams({ serviceKey: key, _type: "json", numOfRows: "100", pageNo: String(page), ...query }).toString();
        let payload;
        try {
          const response = await fetcher(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
          if (!response.ok) throw new TransitError(response.status === 429 ? "QUOTA_EXCEEDED" : [401, 403].includes(response.status) ? "AUTH_REQUIRED" : "PROVIDER_ERROR");
          const raw = await response.text();
          // Gateway authentication failures can be XML even when JSON is requested.
          if (raw.trimStart().startsWith("<")) {
            const code = raw.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/)?.[1];
            throw new TransitError(code === "22" ? "QUOTA_EXCEEDED" : ["20", "21", "30", "31", "32"].includes(code ?? "") ? "AUTH_REQUIRED" : "PROVIDER_ERROR");
          }
          payload = JSON.parse(raw);
        } catch (error) {
          if (error instanceof TransitError) throw error;
          throw new TransitError("PROVIDER_UNAVAILABLE");
        }
        const { items, total } = unpack(payload);
        if (result.length && !items.length) throw new TransitError("INVALID_RESPONSE");
        result.push(...items);
        if (result.length >= total) {
          if (cache.size >= 250) cache.delete(cache.keys().next().value!);
          cache.set(cacheKey, { value: result, expires: Date.now() + ttl });
          return result;
        }
      }
      throw new TransitError("TOO_MANY_RESULTS");
    };
    const request = load().finally(() => pending.delete(cacheKey));
    pending.set(cacheKey, request);
    return request;
  }
  const api = {
    ready: Boolean(key),
    async cities() {
      const rows = await all("BusRouteInfoInqireService", "getCtyCodeList");
      return rows.map(row => ({ id: required(row.citycode), name: required(row.cityname) })).sort((a,b) => a.name.localeCompare(b.name, "ko"));
    },
    async buses(city: string, query: string) {
      const rows = await all("BusRouteInfoInqireService", "getRouteNoList", { cityCode: city, routeNo: query });
      return rows.map(row => ({ id: required(row.routeid), name: required(row.routeno), type: text(row.routetp), start: text(row.startnodenm), end: text(row.endnodenm) }));
    },
    async stops(city: string, route: string) {
      const rows = await all("BusRouteInfoInqireService", "getRouteAcctoThrghSttnList", { cityCode: city, routeId: route });
      return rows.map(row => {
        const id = required(row.nodeid), order = number(row.nodeord), direction = text(row.updowncd);
        return { key: `${id}:${direction}:${order}`, id, name: required(row.nodenm), number: text(row.nodeno), order, direction };
      }).sort((a,b) => a.direction.localeCompare(b.direction) || a.order - b.order);
    },
    async stations(city: string, query: string) {
      const rows = await all("BusSttnInfoInqireService", "getSttnNoList", { cityCode: city, [/^\d+$/.test(query) ? "nodeNo" : "nodeNm"]: query });
      return rows.map(row => ({ id: required(row.nodeid), name: required(row.nodenm), number: text(row.nodeno) }));
    },
    async connections(city: string, from: string, to: string) {
      if (from === to) return [];
      const rows = await all("BusSttnInfoInqireService", "getSttnThrghRouteList", { cityCode: city, nodeid: from });
      const routes = [...new Map(rows.map(row => [required(row.routeid), row])).values()];
      const matches = [];
      // Bound upstream requests; fail the whole search if any candidate fails.
      // A missing arrival must never hide an otherwise usable route.
      for (let offset = 0; offset < routes.length; offset += 3) {
        const batch = await Promise.all(routes.slice(offset, offset + 3).map(async row => {
          const id = required(row.routeid), stops = await api.stops(city, id);
          const pairs = stops.filter(stop => stop.id === from).flatMap(start => {
            const end = stops.find(stop => stop.id === to && stop.direction === start.direction && stop.order > start.order);
            return end ? [{ id, key: `${id}:${start.key}:${end.key}`, name: required(row.routeno), type: text(row.routetp), from: start, to: end, next: stops.find(stop => stop.direction === start.direction && stop.order > start.order)?.name ?? "" }] : [];
          });
          return pairs;
        }));
        matches.push(...batch.flat());
      }
      return matches.sort((a,b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    },
    async arrivals(city: string, node: string, route?: string) {
      const rows = await all("ArvlInfoInqireService", "getSttnAcctoArvlPrearngeInfoList", { cityCode: city, nodeId: node }, 10000);
      return rows.filter(row => !route || text(row.routeid) === route).map(row => ({ routeId: required(row.routeid), seconds: number(required(row.arrtime)), stopsAway: number(required(row.arrprevstationcnt)), vehicle: text(row.vehicletp), checkedAt: new Date().toISOString() })).sort((a,b) => a.seconds - b.seconds);
    },
    async rail() {
      const rows = await all("SubwayInfo", "GetKwrdFndSubwaySttnList");
      const lines = new Map<string, Map<string, { key: string; id: string; name: string; number: string; direction: string; order: number }>>();
      for (const row of rows) {
        const id = required(row.subwayStationId);
        const name = railLineName(required(row.subwayRouteName), id);
        if (!lines.has(name)) lines.set(name, new Map());
        lines.get(name)!.set(id, { key: id, id, name: required(row.subwayStationName), number: "", direction: "", order: 0 });
      }
      return Array.from(lines, ([name, stations]) => ({ id: name, name, stops: [...stations.values()].sort((a,b) => a.name.localeCompare(b.name, "ko")) })).sort((a,b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
    },
  };
  return api;
}
