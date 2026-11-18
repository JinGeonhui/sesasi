import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createWeatherResource, readWeatherCache, weatherCacheKey, WeatherRequestError } from '../app/planner/weather-resource.ts';
import { parseWeather, freshness, maxAge } from '../app/planner/weather-data.ts';
import { createWeatherProvider } from '../transit/weather.mjs';
import { createTransitServer } from '../transit/server.mjs';

const start = Date.parse('2026-11-18T19:15:00+09:00');
const raw = { current: { time: '2026-11-18T19:15', temperature_2m: 8.6, weather_code: 1, relative_humidity_2m: 93 } };
const airRaw = { current: { time: '2026-11-18T19:00', pm10: 20, pm2_5: 12 } };
const payload = () => ({ body: raw, fetchedAt: Date.now() });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function setup(t, options = {}, kind = 'weather') {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  const resource = createWeatherResource(kind, '광주', { storage: () => undefined, now: () => Date.now(), ...options });
  t.after(resource.subscribe(() => {}));
  return resource;
}

test('누락된 선택 항목과 잘못된 필수 응답을 구분한다', () => {
  assert.equal(parseWeather('weather', raw).temp, 9);
  assert.equal(parseWeather('weather', raw).high, null);
  assert.equal(parseWeather('weather', raw).time, raw.current.time);
  assert.equal(parseWeather('air', airRaw).fine, 12);
  assert.throws(() => parseWeather('weather', { current: { time: 'bad' } }));
  assert.throws(() => parseWeather('air', raw));
});

test('13초 걸리는 응답도 중단하지 않고 성공한다', async t => {
  let signal;
  const resource = setup(t, { request: (_kind, _city, s) => { signal = s; return new Promise(resolve => setTimeout(() => resolve(payload()), 13000)); } });
  const finished = resource.refresh();
  t.mock.timers.tick(12000);
  assert.equal(signal.aborted, false);
  assert.equal(resource.getSnapshot().slow, true);
  t.mock.timers.tick(1000);
  await finished;
  assert.equal(resource.getSnapshot().data.temp, 9);
  assert.equal(resource.getSnapshot().error, null);
});

test('35초 제한 후 자동 재시도로 회복하며 대기 상태가 풀린다', async t => {
  let calls = 0;
  const resource = setup(t, { request: (_kind, _city, signal) => {
    if (++calls > 1) return Promise.resolve(payload());
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const finished = resource.refresh();
  t.mock.timers.tick(35000);
  await finished;
  assert.equal(resource.getSnapshot().error, 'timeout');
  assert.equal(resource.getSnapshot().pending, false);
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 2);
  assert.equal(resource.getSnapshot().data.temp, 9);
  assert.equal(resource.getSnapshot().error, null);
});

test('장애 때 저장값을 유지하고 6시간 지난 값은 제거한다', async t => {
  const cache = storage();
  cache.setItem(weatherCacheKey('weather', '광주'), JSON.stringify({ body: raw, fetchedAt: start }));
  const resource = setup(t, { storage: () => cache, request: async () => { throw new WeatherRequestError('network'); } });
  t.mock.timers.tick(freshness); await flush();
  assert.equal(resource.getSnapshot().data.temp, 9);
  assert.equal(resource.getSnapshot().stale, true);
  assert.equal(resource.getSnapshot().error, 'network');
  t.mock.timers.setTime(start + maxAge);
  await resource.refresh();
  assert.equal(resource.getSnapshot().data, null);
});

test('지역·종류별 캐시를 분리하고 손상·만료·미래 자료를 거부한다', () => {
  const cache = storage(), key = weatherCacheKey('weather', '광주');
  cache.setItem(key, JSON.stringify({ body: raw, fetchedAt: start }));
  assert.ok(readWeatherCache('weather', '광주', cache, start));
  assert.equal(readWeatherCache('weather', '서울', cache, start), null);
  assert.equal(readWeatherCache('air', '광주', cache, start), null);
  assert.equal(readWeatherCache('weather', '광주', cache, start + maxAge), null);
  cache.setItem(key, '{broken');
  assert.equal(readWeatherCache('weather', '광주', cache, start), null);
  cache.setItem(key, JSON.stringify({ body: { current: { ...raw.current, time: '2026-11-19T19:15' } }, fetchedAt: start }));
  assert.equal(readWeatherCache('weather', '광주', cache, start), null);
});

test('요청 제한 대기 시간에는 수동 새로고침도 추가 요청하지 않는다', async t => {
  let calls = 0;
  const resource = setup(t, { request: async () => { calls++; throw new WeatherRequestError('rate-limit', 60000); } });
  await resource.refresh();
  await resource.refresh();
  t.mock.timers.tick(59999); await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush();
  assert.equal(calls, 2);
});

test('구독 종료 후 늦게 도착한 응답은 화면·저장값을 변경하지 않는다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  let resolve, signal;
  const cache = storage();
  const resource = createWeatherResource('weather', '광주', { storage: () => cache, now: () => Date.now(), request: (_k, _c, s) => { signal = s; return new Promise(r => { resolve = r; }); } });
  const unsubscribe = resource.subscribe(() => {});
  const request = resource.refresh();
  unsubscribe();
  assert.equal(signal.aborted, true);
  resolve(payload()); await request;
  assert.equal(resource.getSnapshot().data, null);
  assert.equal(cache.getItem(weatherCacheKey('weather', '광주')), null);
});

test('저장소가 가득 차도 정상 조회 결과를 표시한다', async t => {
  const resource = setup(t, { storage: () => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }), request: async () => payload() });
  await resource.refresh();
  assert.equal(resource.getSnapshot().data.temp, 9);
  assert.equal(resource.getSnapshot().error, null);
});

test('날씨 요청 중단이 대기질 조회를 중단하지 않는다', async t => {
  const weather = setup(t, { request: (_k, _c, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))) });
  const air = createWeatherResource('air', '광주', { storage: () => undefined, now: () => Date.now(), request: async () => ({ body: airRaw, fetchedAt: Date.now() }) });
  t.after(air.subscribe(() => {}));
  const waiting = weather.refresh(); await air.refresh();
  t.mock.timers.tick(35000); await waiting;
  assert.equal(weather.getSnapshot().error, 'timeout');
  assert.equal(air.getSnapshot().data.fine, 12);
  assert.equal(air.getSnapshot().stale, false);
});

test('서버는 동시 조회를 공유하고 15분 동안 성공 응답을 재사용한다', async () => {
  let calls = 0, time = start;
  const provider = createWeatherProvider(async () => { calls++; return Response.json(raw); }, () => time);
  const [a, b] = await Promise.all([provider.read('weather', '광주'), provider.read('weather', '광주')]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  await provider.read('weather', '광주'); assert.equal(calls, 1);
  await provider.read('weather', '서울'); assert.equal(calls, 2);
  time += freshness;
  await provider.read('weather', '광주'); assert.equal(calls, 3);
  await assert.rejects(provider.read('weather', '없는도시'), /INVALID_REQUEST/);
});

test('서버가 30초 후 명시적인 timeout을 반환하고 실패를 캐시하지 않는다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  let calls = 0;
  const provider = createWeatherProvider(async (_url, { signal }) => {
    if (++calls > 1) return Response.json(raw);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort'))));
  }, () => Date.now());
  const request = assert.rejects(provider.read('weather', '광주'), /WEATHER_TIMEOUT/);
  t.mock.timers.tick(30000); await request;
  assert.equal((await provider.read('weather', '광주')).body.current.temperature_2m, 8.6);
});

test('날씨 경로는 교통 키 없이 동작하고 CORS·입력·요청 제한을 처리한다', async t => {
  let limited = false;
  const provider = createWeatherProvider(async () => limited ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : Response.json(raw), () => start);
  const server = createTransitServer({ allowedOrigins: ['http://localhost:3000'] }, { ready: false }, provider);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path, origin = 'http://localhost:3000') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Origin: origin } });
  const good = await request('/v1/weather?city=광주');
  assert.equal(good.status, 200);
  assert.equal((await good.json()).body.current.temperature_2m, 8.6);
  assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal((await request('/v1/weather?city=광주', 'https://other.invalid')).status, 403);
  for (const path of ['/v1/weather', '/v1/weather?city=잘못됨', '/v1/weather?city=광주&city=서울', '/v1/weather?city=광주&url=bad']) assert.equal((await request(path)).status, 400);
  limited = true;
  const busy = await request('/v1/air?city=광주');
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '120');
  assert.equal(busy.headers.get('access-control-expose-headers'), 'Retry-After');
  assert.equal((await busy.json()).code, 'WEATHER_RATE_LIMITED');
});
