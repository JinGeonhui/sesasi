"use client";

import { cloudConfigured } from "./cloud";
import { useEffect, useSyncExternalStore } from "react";
import { categoryPrefix } from "./categories";
import { prefix } from "./data";
import { getDiscordState, getServerDiscordState, refreshDiscord, subscribeDiscord } from "./discord-client";

export function DiscordSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false, again = false, alive = true;
    const run = async () => {
      if (!alive) return;
      if (busy) { again = true; return; }
      busy = true;
      await refreshDiscord();
      busy = false;
      if (again) { again = false; schedule(); }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void run(), 600); };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith(prefix) || event.key.startsWith(categoryPrefix) || event.key.startsWith("sesasi.discord.")) schedule();
    };
    const visible = () => { if (document.visibilityState === "visible") schedule(); };
    schedule();
    const poll = setInterval(schedule, cloudConfigured ? 60000 : 10000);
    window.addEventListener("storage", storage);
    window.addEventListener("sesasi-planner-change", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("sesasi-cloud-auth", schedule);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false; clearTimeout(timer); clearInterval(poll);
      window.removeEventListener("storage", storage);
      window.removeEventListener("sesasi-planner-change", schedule);
      window.removeEventListener("online", schedule);
      window.removeEventListener("sesasi-cloud-auth", schedule);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}

export function DiscordMemoStatus() {
  const { status, error } = useSyncExternalStore(subscribeDiscord, getDiscordState, getServerDiscordState);
  if (!status?.configured) return null;
  return <p className="db-discord-memo-status" role="status" title={error || undefined}>
    {error ? "메모 저장됨 · 디스코드 전송 대기" : status.pending ? "디스코드에 반영 중…" : "디스코드 연동 중"}
  </p>;
}
