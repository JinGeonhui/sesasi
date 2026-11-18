import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
async function configuration(name) {
  try { return parseEnv(await readFile(new URL(name, import.meta.url), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; return {}; }
}
const cloudConfig = await configuration("../.env.local");
const cloudEnabled = Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL || cloudConfig.NEXT_PUBLIC_SUPABASE_URL) && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || cloudConfig.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
const transitConfig = await configuration("../.env.transit.local");
const discordConfig = await configuration("../.env.discord.local");
const transitPort = process.env.TRANSIT_PORT ?? transitConfig.TRANSIT_PORT ?? "4191";
const discordPort = process.env.DISCORD_PORT ?? discordConfig.DISCORD_PORT ?? "4192";
const services = [
  { name: "교통 조회", port: transitPort, envFile: ".env.transit.local", script: "transit/server.mjs",
    origin: (process.env.TRANSIT_ALLOWED_ORIGINS ?? transitConfig.TRANSIT_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0].trim(),
    matches: body => typeof body.ready === "boolean" },
  { name: "디스코드 연결", port: discordPort, envFile: ".env.discord.local", script: "discord/server.mjs",
    origin: (process.env.DISCORD_ALLOWED_ORIGINS ?? discordConfig.DISCORD_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0].trim(),
    matches: body => body.service === "sesasi-discord" },
];
const children = [];
let stopping = false;
async function running(service) {
  try {
    const response = await fetch(`http://127.0.0.1:${service.port}/v1/status`, { headers: { Origin: service.origin }, signal: AbortSignal.timeout(1000) });
    if (!response.ok || !service.matches(await response.json())) throw new Error("PORT_IN_USE");
    return true;
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return false;
    throw error;
  }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  if (cloudEnabled) console.log("Supabase 연결 서버를 사용합니다.");
  for (const service of cloudEnabled ? [] : services) {
    if (stopping) break;
    if (await running(service)) { console.log(`실행 중인 ${service.name} 서버를 사용합니다.`); continue; }
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", `--env-file-if-exists=${service.envFile}`, service.script], { cwd: root, stdio: "inherit" });
    children.push(child);
    child.on("error", () => stop(1));
    child.on("exit", () => {
      if (!stopping) { console.error(`${service.name} 서버가 종료되어 개발 서버도 종료합니다. npm run dev로 다시 실행해 주세요.`); stop(1); }
    });
    let ready = false;
    for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
      if (await running(service)) { ready = true; break; }
      await delay(100);
    }
    if (!ready && !stopping) throw new Error("SERVICE_START_FAILED");
  }
  if (!stopping) {
    const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], {
      cwd: root, stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_DISCORD_PORT: discordPort, NEXT_PUBLIC_TRANSIT_PORT: transitPort },
    });
    children.push(web);
    web.on("error", () => stop(1));
    web.on("exit", code => stop(code ?? 0));
  }
} catch {
  console.error("연결 서버를 시작하지 못했습니다. 포트와 연결 설정을 확인해 주세요.");
  stop(1);
}
