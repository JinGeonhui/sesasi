import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createTransitProvider, unpack, TransitError } from "../transit/provider.mjs";
import { createTransitServer } from "../transit/server.mjs";
import { transitPick } from "../app/planner/transit.ts";

const payload = (item, total = Array.isArray(item) ? item.length : 1) => ({ response: { header: { resultCode: "00" }, body: { items: { item }, totalCount: total } } });
const json = data => new Response(JSON.stringify(data));
test("TAGO의 단건·빈 목록과 오류 응답을 구분한다", () => {
  assert.equal(unpack(payload({ citycode: 24 })).items.length, 1);
  assert.deepEqual(unpack(payload("", 0)).items, []);
  assert.deepEqual(unpack({ response: { header: { resultCode: "03" } } }).items, []);
  assert.throws(() => unpack(payload("", 2)), /INVALID_RESPONSE/);
  assert.throws(() => unpack({ response: { header: { resultCode: "30" } } }), /AUTH_REQUIRED/);
  assert.throws(() => unpack({ response: { header: { resultCode: "22" } } }), /QUOTA_EXCEEDED/);
});
test("서비스키가 없으면 공공 API를 호출하지 않는다", async () => {
  const api = createTransitProvider("", () => assert.fail("no network"));
  assert.equal(api.ready, false);
  await assert.rejects(api.cities(), /SETUP_REQUIRED/);
});
test("인코딩된 키는 한 번만 인코딩하고 모든 페이지를 읽고 동시 요청을 공유한다", async () => {
  const calls = [];
  const api = createTransitProvider("test%2Bkey%3D", async url => {
    calls.push(url);
    assert.equal(url.searchParams.get("serviceKey"), "test+key=");
    assert.equal(url.searchParams.get("cityCode"), "24");
    const page = url.searchParams.get("pageNo");
    return json(payload([{ routeid: `route${page}`, routeno: `노선${page}` }], 2));
  });
  const [a, b] = await Promise.all([api.buses("24", "노선"), api.buses("24", "노선")]);
  assert.equal(a.length, 2); assert.deepEqual(a, b); assert.equal(calls.length, 2);
  await api.buses("24", "노선"); assert.equal(calls.length, 2);
});
test("XML 게이트웨이 오류에서 인증키·원문을 노출하지 않는다", async () => {
  const api = createTransitProvider("private-test-key", async () => new Response("<error><returnReasonCode>30</returnReasonCode><message>private-test-key</message></error>"));
  await assert.rejects(api.cities(), error => error.code === "AUTH_REQUIRED" && !error.message.includes("private-test-key"));
});
test("미승인 서비스의 HTTP 403을 인증 상태로 표시한다", async () => {
  const api = createTransitProvider("test", async () => new Response("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", { status: 403 }));
  await assert.rejects(api.stations("24", "터미널"), /AUTH_REQUIRED/);
});
test("중간 페이지 장애는 부분 목록을 캐시하지 않고 재시도한다", async () => {
  let fail = true, calls = 0;
  const api = createTransitProvider("test", async url => {
    calls++;
    if (url.searchParams.get("pageNo") === "2") {
      if (fail) throw new Error("network");
      return json(payload({ routeid: "b", routeno: 2 }, 2));
    }
    return json(payload({ routeid: "a", routeno: 1 }, 2));
  });
  await assert.rejects(api.buses("24", "1"), /PROVIDER_UNAVAILABLE/);
  fail = false;
  assert.equal((await api.buses("24", "1")).length, 2);
  assert.equal(calls, 4);
});
test("정류장은 방향·순번으로 정렬하고 같은 정류장을 재방문하는 항목을 구분한다", async () => {
  const api = createTransitProvider("test", async () => json(payload([
    { nodeid: "a", nodenm: "정류장", nodeord: 3, updowncd: 0 },
    { nodeid: "a", nodenm: "정류장", nodeord: 1, updowncd: 0 },
    { nodeid: "b", nodenm: "반대편", nodeord: 1, updowncd: 1 },
  ])));
  const stops = await api.stops("24", "route");
  assert.deepEqual(stops.map(stop => stop.order), [1, 3, 1]);
  assert.equal(new Set(stops.map(stop => stop.key)).size, 3);
});
test("지하철은 공식 대문자 경로를 사용하고 호선별 역 ID를 보존한다", async () => {
  const api = createTransitProvider("test", async url => {
    assert.equal(url.pathname, "/1613000/SubwayInfo/GetKwrdFndSubwaySttnList");
    assert.equal(url.searchParams.has("subwayStationName"), false);
    return json(payload([
      { subwayRouteName: "1호선", subwayStationId: "MTRS11150", subwayStationName: "서울역" },
      { subwayRouteName: "2호선", subwayStationId: "MTRS12228", subwayStationName: "서울대입구" },
      { subwayRouteName: "2호선", subwayStationId: "MTRS12249", subwayStationName: "신정네거리" },
    ]));
  });
  const lines = await api.rail();
  assert.equal(lines.length, 2);
  assert.equal(lines[1].stops.length, 2);
  assert.equal(lines[0].stops[0].id, "MTRS11150");
});
test("같은 호선명의 다른 도시를 분리하고 수도권 공동 운영 구간은 합친다", async () => {
  const api = createTransitProvider("test", async () => json(payload([
    { subwayRouteName: "1호선", subwayStationId: "MTRGJ1117", subwayStationName: "광주송정역" },
    { subwayRouteName: "1호선", subwayStationId: "MTRBS10124", subwayStationName: "교대" },
    { subwayRouteName: "1호선", subwayStationId: "MTRDG10128", subwayStationName: "교대" },
    { subwayRouteName: "1호선", subwayStationId: "MTRDJ10013", subwayStationName: "갈마" },
    { subwayRouteName: "1호선", subwayStationId: "MTRKR1109", subwayStationName: "가능" },
    { subwayRouteName: "1호선", subwayStationId: "MTRS11150", subwayStationName: "서울역" },
    { subwayRouteName: "1호선", subwayStationId: "MTRS11150", subwayStationName: "서울역" },
  ])));
  const lines = await api.rail();
  assert.equal(lines.length, 5);
  assert.equal(new Set(lines.map(line => line.id)).size, 5);
  assert.deepEqual(lines.find(line => line.name === "광주 1호선").stops.map(stop => stop.name), ["광주송정역"]);
  assert.deepEqual(lines.find(line => line.name === "수도권 1호선").stops.map(stop => stop.name), ["가능", "서울역"]);
});
test("선택한 노선의 정류장만 저장하며 반대 방향·역순 버스 구간을 거부한다", () => {
  const stops = [
    { key: "a:0:1", id: "a", name: "승차", direction: "0", order: 1 },
    { key: "b:0:2", id: "b", name: "하차", direction: "0", order: 2 },
    { key: "c:1:3", id: "c", name: "반대편", direction: "1", order: 3 },
  ];
  const line = { id: "official-route", name: "시험 노선" }, city = { id: "24", name: "광주광역시" };
  const pick = transitPick(line, stops, "a:0:1", "b:0:2", true, city);
  assert.equal(pick.transit.routeId, "official-route");
  assert.equal(pick.transit.fromId, "a"); assert.equal(pick.transit.cityCode, "24");
  for (const [from, to] of [["a:0:1", "c:1:3"], ["b:0:2", "a:0:1"], ["a:0:1", "a:0:1"], ["a:0:1", "unknown"]]) assert.equal(transitPick(line, stops, from, to, true, city), null);
  assert.ok(transitPick(line, stops, "b:0:2", "a:0:1", false));
});

async function serve(t, provider) {
  const server = createTransitServer({ allowedOrigins: ["http://localhost:3000"] }, provider);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, options = {}) => fetch(base + path, { headers: { Origin: "http://localhost:3000" }, ...options });
}
test("조회 서버는 허용 origin·요청 파라미터를 검증한다", async t => {
  let calls = 0;
  const request = await serve(t, { ready: true, buses: async () => { calls++; return []; } });
  for (const path of ["/v1/buses?city=24", "/v1/buses?city=bad&q=1", "/v1/buses?city=24&q=1&url=bad", "/v1/buses?city=24&q=1&q=2"]) assert.equal((await request(path)).status, 400);
  assert.equal((await request("/v1/buses?city=24&q=1", { headers: { Origin: "https://other.invalid" } })).status, 403);
  assert.equal(calls, 0);
  const result = await request("/v1/buses?city=24&q=1");
  assert.equal(result.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.deepEqual(await result.json(), { items: [] }); assert.equal(calls, 1);
});
test("키 미설정과 공급자 장애는 노선 없음으로 위장하지 않는다", async t => {
  const request = await serve(t, { ready: false });
  assert.deepEqual(await (await request("/v1/cities")).json(), { code: "SETUP_REQUIRED" });
  const failed = await serve(t, { ready: true, cities: async () => { throw new TransitError("AUTH_REQUIRED"); } });
  const response = await failed("/v1/cities");
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), { code: "AUTH_REQUIRED" });
});

test("정류장 이름과 번호 검색을 구분하고 정류장 ID를 유지한다", async () => {
  const queries = [];
  const api = createTransitProvider("test", async url => {
    assert.ok(url.pathname.endsWith("/BusSttnInfoInqireService/getSttnNoList"));
    queries.push(Object.fromEntries(url.searchParams));
    return json(payload({ nodeid: "KJB2002", nodenm: "광주종합버스터미널", nodeno: 2002 }));
  });
  assert.deepEqual(await api.stations("24", "광주종합"), [{ id: "KJB2002", name: "광주종합버스터미널", number: "2002" }]);
  await api.stations("24", "2002");
  assert.equal(queries[0].nodeNm, "광주종합");
  assert.equal(queries[1].nodeNo, "2002");
});
test("승하차 검색은 승차 후 같은 방향의 하차 정류장을 지나는 노선만 반환한다", async () => {
  const api = createTransitProvider("test", async url => {
    if (url.pathname.endsWith("getSttnThrghRouteList")) {
      assert.equal(url.searchParams.get("nodeid"), "start");
      return json(payload(["forward", "reverse", "opposite", "missing"].map(routeid => ({ routeid, routeno: routeid }))));
    }
    const id = url.searchParams.get("routeId");
    const rows = [
      { nodeid: "start", nodenm: "승차", nodeord: 2, updowncd: 0 },
      { nodeid: "next", nodenm: "다음", nodeord: 3, updowncd: 0 },
    ];
    if (id !== "missing") rows.push({ nodeid: "end", nodenm: "하차", nodeord: id === "reverse" ? 1 : 4, updowncd: id === "opposite" ? 1 : 0 });
    return json(payload(rows));
  });
  const found = await api.connections("24", "start", "end");
  assert.deepEqual(found.map(line => line.id), ["forward"]);
  assert.equal(found[0].next, "다음");
  assert.equal(found[0].from.key, "start:0:2");
  assert.equal(found[0].to.key, "end:0:4");
});
test("후보 노선 조회가 실패하면 불완전한 검색을 성공으로 반환하지 않는다", async () => {
  const api = createTransitProvider("test", async url => {
    if (url.pathname.endsWith("getSttnThrghRouteList")) return json(payload({ routeid: "broken", routeno: "1" }));
    throw new Error("network");
  });
  await assert.rejects(api.connections("24", "start", "end"), /PROVIDER_UNAVAILABLE/);
});
test("도착 정보는 노선별로 분리하고 10초 이후 다시 조회한다", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  let calls = 0;
  const api = createTransitProvider("test", async url => {
    calls++;
    assert.ok(url.pathname.endsWith("/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList"));
    assert.equal(url.searchParams.get("nodeId"), "stop");
    return json(payload([
      { routeid: "a", arrtime: 600, arrprevstationcnt: 5, vehicletp: "일반버스" },
      { routeid: "b", arrtime: 30, arrprevstationcnt: 1 },
      { routeid: "a", arrtime: 120, arrprevstationcnt: 2, vehicletp: "저상버스" },
    ]));
  });
  assert.deepEqual((await api.arrivals("24", "stop", "a")).map(row => row.seconds), [120, 600]);
  assert.equal((await api.arrivals("24", "stop", "b")).length, 1);
  assert.equal(calls, 1);
  t.mock.timers.tick(10001);
  await api.arrivals("24", "stop", "a");
  assert.equal(calls, 2);
  assert.deepEqual(await api.arrivals("24", "stop", "absent"), []);
});

test("같은 승차 정류장의 여러 카드가 도착 요청 하나를 공유한다", async t => {
  const { stationArrivals } = await import('../app/planner/transit.ts');
  const previous = process.env.NEXT_PUBLIC_TRANSIT_API_URL;
  process.env.NEXT_PUBLIC_TRANSIT_API_URL = 'http://127.0.0.1:4191';
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_TRANSIT_API_URL; else process.env.NEXT_PUBLIC_TRANSIT_API_URL = previous; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    assert.ok(String(url).includes('/v1/station-arrivals?'));
    return json({ items: [{ routeId: 'a', seconds: 60, stopsAway: 1, vehicle: '', checkedAt: new Date().toISOString() }] });
  });
  const results = await Promise.all(Array.from({ length: 26 }, () => stationArrivals('test-city', 'test-stop')));
  assert.equal(calls, 1);
  assert.equal(results.length, 26);
  await stationArrivals('test-city', 'test-stop');
  assert.equal(calls, 1);
});
