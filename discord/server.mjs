import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDiscordService, DiscordError } from "./service.mjs";

export function createDiscordServer(service, allowedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"]) {
  const origins = new Set(allowedOrigins);
  let active = 0;
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = typeof origin === "string" && origins.has(origin);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    if (allowed) Object.assign(headers, { "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    const send = (status, body) => { res.writeHead(status, headers); res.end(JSON.stringify(body)); };
    if (!allowed) return send(403, { code: "ORIGIN_DENIED" });
    if (req.method === "OPTIONS") return send(204, {});
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/v1/status") return send(200, service.status(url.searchParams.get("sourceId")));
    const operations = {
      "POST /v1/sync": body => service.submit(body),
    };
    const run = operations[`${req.method} ${url.pathname}`];
    if (!run) return send(404, { code: "NOT_FOUND" });
    if (!req.headers["content-type"]?.startsWith("application/json")) return send(415, { code: "INVALID_REQUEST" });
    if (active >= 4) return send(429, { code: "BUSY" });
    active++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw new DiscordError("INVALID_MEMOS"); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new DiscordError("INVALID_REQUEST"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new DiscordError("INVALID_REQUEST");
      send(200, await run(body));
      void service.flush();
    } catch (error) { send(error instanceof DiscordError ? 400 : 500, { code: error instanceof DiscordError ? error.code : "STATE_UNAVAILABLE" }); }
    finally { active--; }
  });
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try { await service.flush(); } finally { ticking = false; }
  }, 5000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const service = await createDiscordService({
      file: fileURLToPath(new URL("./private/state.json", import.meta.url)),
      webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? "",
      since: process.env.DISCORD_SYNC_FROM ?? "",
    });
    const server = createDiscordServer(service, (process.env.DISCORD_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map(s => s.trim()));
    server.listen(Number(process.env.DISCORD_PORT ?? 4192), "127.0.0.1", () => console.log(`Discord memo API listening on 127.0.0.1:${server.address().port} (${process.env.DISCORD_WEBHOOK_URL ? "configured" : "webhook not set"}).`));
  } catch { console.error("디스코드 연결 설정을 읽지 못했습니다. .env.discord.local과 discord/private/ 저장소를 확인해 주세요."); process.exitCode = 1; }
}
