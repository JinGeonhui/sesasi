import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discordLines, discordMessages, memoCreatedOn, memoDay, memoRows } from "../app/planner/discord-format.ts";
import { createDiscordService, validateSnapshot, webhookURL } from "../discord/service.mjs";
import { createDiscordServer } from "../discord/server.mjs";

const day = "2026-11-18", sourceId = "browser-test-source-12345";
const webhook = `https://discord.com/api/webhooks/123456789012345678/${"x".repeat(68)}`;
const memo = (values = {}) => ({ id: "one", kind: "todo", date: day, title: "오후 4시 10분 장내 기능 시험", category: "면허", done: false, order: "1", createdOn: "2026-11-17", ...values });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("앱과 디스코드가 미리 작성·당일 추가·완료에 같은 목록 표시를 쓴다", () => {
  const todos = [memo({ id: 'first', order: '1' }), memo({ id: 'second', order: '2' }),
    memo({ id: 'extra', order: '3', createdOn: day }), memo({ id: 'done', order: '4', done: true })];
  assert.deepEqual(memoRows(todos).map(row => row.marker), ['1.', '2.', '-', '-']);
  assert.deepEqual(discordLines(day, todos), ['1. [면허] 오후 4시 10분 장내 기능 시험', '2. [면허] 오후 4시 10분 장내 기능 시험',
    '- [면허] 오후 4시 10분 장내 기능 시험', '- ~~[면허] 오후 4시 10분 장내 기능 시험~~']);
  const completed = todos.map(todo => todo.id === 'first' ? { ...todo, done: true } : todo);
  assert.deepEqual(memoRows(completed).map(row => row.marker), ['-', '1.', '-', '-']);
  assert.deepEqual(memoRows(completed.map(todo => todo.id === 'first' ? { ...todo, done: false } : todo)).map(row => row.marker), ['1.', '2.', '-', '-']);
  assert.deepEqual(memoRows([...todos, memo({ id: 'tomorrow', date: '2026-11-19' })]).map(row => row.marker), ['1.', '2.', '-', '-', '1.']);
});
test("당일 추가 여부는 기기 시간대가 아닌 한국 날짜를 기준으로 저장한다", () => {
  assert.equal(memoDay(new Date('2026-11-18T14:59:59Z')), '2026-11-18');
  assert.equal(memoDay(new Date('2026-11-18T15:00:00Z')), '2026-11-19');
});

test("미리 쓴 메모만 번호를 붙이고 당일 메모는 -로 표시한다", () => {
  assert.deepEqual(discordLines(day, [memo(), memo({ id: "two", order: "2", title: "82뽑 픽뚫 블레이드", category: "게임", createdOn: day }),
    memo({ id: "three", order: "3", title: "발표 확인", category: "대학" })]),
  ["1. [면허] 오후 4시 10분 장내 기능 시험", "- [게임] 82뽑 픽뚫 블레이드", "2. [대학] 발표 확인"]);
});
test("완료 시 번호 대신 -와 취소선을 쓰고 해제하면 번호로 복원한다", () => {
  assert.equal(discordMessages(day, [memo({ done: true })])[0], "# 2026.11.18\n- ~~[면허] 오후 4시 10분 장내 기능 시험~~");
  assert.equal(discordLines(day, [memo({ done: false })])[0], "1. [면허] 오후 4시 10분 장내 기능 시험");
  assert.match(discordLines(day, [memo({ done: true, createdOn: day })])[0], /^- ~~/);
});
test("작성일은 대상 날짜와 비교하고 과거 데이터의 정렬 시각도 복원한다", () => {
  const stamp = new Date(2026, 10, 17, 12).getTime();
  assert.equal(memoCreatedOn(memo({ createdOn: undefined, order: `1-${stamp}-id` })), "2026-11-17");
  assert.equal(memoCreatedOn(memo({ createdOn: undefined, order: `1-1000000000000-a/${9999999999999 - stamp}-b` })), "2026-11-17");
  assert.match(discordLines(day, [memo({ createdOn: "" })])[0], /^- /);
  assert.match(discordLines(day, [memo({ createdOn: "2026-11-19" })])[0], /^- /);
  assert.equal(discordLines(day, [memo({ date: "2026-11-19" })]).length, 0);
});
test("원문 마크다운이 취소선과 목록 구조를 깨지 않으며 긴 목록은 2000자 이하로 나눈다", () => {
  assert.equal(discordLines(day, [memo({ category: "[태그]", title: "**제목**\n~~내용~~ @everyone", done: true })])[0], "- ~~[\\[태그\\]] \\*\\*제목\\*\\* \\~\\~내용\\~\\~ @everyone~~");
  const memos = Array.from({ length: 100 }, (_, i) => memo({ id: String(i), title: "가".repeat(120), order: String(i).padStart(3, "0") }));
  const parts = discordMessages(day, memos);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 2000 && part.startsWith("# 2026.11.18\n")));
  assert.equal(parts.flatMap(part => part.split("\n").slice(1)).length, 100);
  assert.deepEqual(discordMessages(day, []), []);
});
test("임의 호스트·잘못된 날짜·중복 ID·부분 스냅샷을 거부한다", () => {
  for (const url of ["http://localhost:4191/", webhook.replace("discord.com", "discord.com.evil.test"), webhook + "/messages/123", webhook + "?url=bad", webhook.replace("https:", "http:")]) assert.throws(() => webhookURL(url));
  assert.ok(webhookURL(webhook).includes("/api/v10/webhooks/"));
  assert.ok(webhookURL(webhook + "?thread_id=123456789012345678").endsWith("thread_id=123456789012345678"));
  for (const list of [[memo({ date: "2026-02-30" })], [memo(), memo()], [memo({ title: 42 })], [memo({ createdOn: undefined })], {}]) assert.throws(() => validateSnapshot(list));
});

async function fixture(t, customFetch) {
  const directory = await mkdtemp(join(tmpdir(), "sesasi-discord-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const calls = [];
  let id = 123456789012345600n, time = Date.now();
  const fetchImpl = async (url, options) => {
    const record = { url: String(url), method: options.method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(record);
    const intercepted = await customFetch?.(record);
    if (intercepted) return intercepted;
    if (record.method === "GET") return json({ type: 1, id: "123456789012345678", name: "메모", channel_id: "223456789012345678", token: "do-not-expose" });
    if (record.method === "DELETE") return new Response(null, { status: 204 });
    if (record.method === "POST") { assert.ok(record.url.endsWith("wait=true")); return json({ id: String(++id) }); }
    return json({ id: "123456789012345601" });
  };
  const options = { file, webhookUrl: webhook, since: day, fetchImpl, now: () => time };
  const service = await createDiscordService(options);
  const submit = async todos => { await service.submit({ sourceId, todos }); await service.flush(); };
  return { service, calls, file, options, submit, advance: ms => { time += ms; } };
}
test("최초에는 게시하고 수정·완료는 같은 메시지를 편집하며 서버 재시작 후에도 ID를 유지한다", async t => {
  const f = await fixture(t);
  await f.service.flush();
  assert.equal(f.calls.length, 0); // Starting the service alone never sends memos.
  await f.submit([memo()]);
  await f.submit([memo({ done: true })]);
  assert.deepEqual(f.calls.map(c => c.method), ["POST", "PATCH"]);
  assert.deepEqual(f.calls[1].body.allowed_mentions, { parse: [] });
  assert.ok(f.calls[1].url.endsWith("/messages/123456789012345601"));
  const restarted = await createDiscordService(f.options);
  await restarted.submit({ sourceId, todos: [memo({ title: "시험 합격", done: true })] });
  await restarted.flush();
  assert.equal(f.calls.at(-1).method, "PATCH");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  const status = JSON.stringify(restarted.status(sourceId));
  assert.equal(status.includes("do-not-expose"), false);
  assert.equal(status.includes("webhook"), false);
});
test("변경 없는 반복 요청은 다시 보내지 않고 날짜 이동·삭제를 반영한다", async t => {
  const f = await fixture(t); await f.submit([memo()]);
  await f.submit([memo()]); assert.equal(f.calls.length, 1);
  await f.submit([memo({ date: "2026-11-19" })]);
  assert.deepEqual(f.calls.slice(1).map(c => c.method), ["DELETE", "POST"]);
  await f.submit([]); assert.equal(f.calls.at(-1).method, "DELETE");
  assert.equal(f.service.status(sourceId).pending, false);
});
test("env URL을 비우면 기존 연결도 중지되고 다시 설정하면 같은 메시지에 이어 쓴다", async t => {
  const f = await fixture(t); await f.submit([memo()]);
  const disabled = await createDiscordService({ ...f.options, webhookUrl: "" });
  assert.equal(disabled.status(sourceId).configured, false);
  await disabled.flush();
  await assert.rejects(disabled.submit({ sourceId, todos: [] }), /SETUP_REQUIRED/);
  assert.equal(f.calls.length, 1);
  const enabled = await createDiscordService(f.options);
  await enabled.submit({ sourceId, todos: [memo({ done: true })] }); await enabled.flush();
  assert.equal(f.calls.at(-1).method, "PATCH");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await readFile(f.file, "utf8")).includes("x".repeat(68)), false);
});
test("빈 브라우저는 연결을 선점하지 않고 연결 후 다른 브라우저는 기존 메모를 지우지 않는다", async t => {
  const f = await fixture(t);
  await f.service.submit({ sourceId: "empty-browser-source", todos: [] });
  await f.submit([memo()]);
  await assert.rejects(f.service.submit({ sourceId: "empty-browser-source", todos: [] }), /SOURCE_MISMATCH/);
  assert.equal(f.calls.length, 1);
});
test("429 응답은 대기 후 재시도하며 이미 보낸 메시지를 중복 게시하지 않는다", async t => {
  let limited = true;
  const f = await fixture(t, record => record.method === "PATCH" && limited ? json({ retry_after: 10 }, 429) : null);
  await f.submit([memo()]); await f.submit([memo({ done: true })]);
  assert.equal(f.service.status(sourceId).error, "RATE_LIMITED");
  assert.equal(f.service.status(sourceId).pending, true);
  const count = f.calls.length; await f.service.flush(); assert.equal(f.calls.length, count);
  limited = false; f.advance(10001); await f.service.flush();
  assert.equal(f.service.status(sourceId).pending, false);
  assert.equal(f.service.status(sourceId).error, "");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});
test("2000자를 넘는 날짜별 메모는 나눠 보내고 줄어들면 남는 메시지를 삭제한다", async t => {
  const f = await fixture(t);
  const rows = Array.from({ length: 40 }, (_, i) => memo({ id: String(i), title: "긴 메모 ".repeat(20), order: String(i) }));
  await f.submit(rows);
  const count = f.calls.filter(c => c.method === "POST").length;
  assert.ok(count > 1);
  await f.submit([rows[0]]);
  assert.equal(f.calls.filter(c => c.method === "DELETE").length, count - 1);
});
test("수동으로 삭제된 메시지만 새로 만들고 웹후크 삭제는 새 게시로 우회하지 않는다", async t => {
  let code = 10008;
  const f = await fixture(t, record => record.method === "PATCH" ? json({ code }, 404) : null);
  await f.submit([memo()]); await f.submit([memo({ done: true })]);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 2);
  code = 10015; await f.submit([memo()]);
  assert.equal(f.service.status(sourceId).error, "WEBHOOK_UNAVAILABLE");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 2);
});
test("env의 시작 날짜를 늦춰도 이전 날짜 게시물은 지우지 않는다", async t => {
  const f = await fixture(t); await f.submit([memo()]);
  const service = await createDiscordService({ ...f.options, since: "2026-11-19" });
  await service.submit({ sourceId, todos: [] }); await service.flush();
  assert.equal(f.calls.some(c => c.method === "DELETE"), false);
  assert.equal(service.status(sourceId).pending, false);
});
test("웹 API로 연결을 설정할 수 없고 허용 Origin의 JSON 메모만 받는다", async t => {
  const f = await fixture(t);
  const server = createDiscordServer(f.service);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  assert.equal((await fetch(base + "/v1/status")).status, 403);
  assert.equal((await fetch(base + "/v1/status", { headers: { Origin: "https://evil.test" } })).status, 403);
  for (const method of ["PUT", "DELETE"]) {
    assert.equal((await fetch(base + "/v1/connection", { method, headers, body: "{}" })).status, 404);
  }
  assert.equal((await fetch(base + "/v1/sync", { method: "POST", headers: { Origin: "http://localhost:3000" }, body: "{}" })).status, 415);
  const response = await fetch(base + "/v1/sync", { method: "POST", headers, body: JSON.stringify({ sourceId, todos: [memo()] }) });
  assert.equal(response.status, 200);
  const value = await response.text(); assert.equal(value.includes("x".repeat(68)), false);
  await f.service.flush();
  assert.equal(f.calls.length, 1);
});
