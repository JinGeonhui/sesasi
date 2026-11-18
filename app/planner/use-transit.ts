import { useEffect, useState } from "react";
import { transitList } from "./transit";

export function useTransit<T>(path: string, params: Record<string, string>, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const query = JSON.stringify(params), key = JSON.stringify([path, query, attempt]);
  const [result, setResult] = useState<{ key: string; items: T[]; error: string }>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    transitList<T>(path, JSON.parse(query), controller.signal).then(items => {
      if (!controller.signal.aborted) setResult({ key, items, error: "" });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, items: [], error: error instanceof Error ? error.message : "교통정보를 불러오지 못했어요." });
    });
    return () => controller.abort();
  }, [path, query, key, enabled]);
  const current = enabled && result?.key === key ? result : undefined;
  return { items: current?.items ?? [], error: current?.error ?? "", loading: enabled && !current, retry: () => setAttempt(value => value + 1) };
}
