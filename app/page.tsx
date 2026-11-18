"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Keep previously bookmarked story links working after moving the film page.
    const hash = window.location.hash;
    router.replace(hash.startsWith("#story/") ? `/film/${hash}` : "/planner/");
  }, [router]);
  return <main style={{ padding: 24 }}><p role="status">작업 페이지로 이동 중…</p><Link href="/planner/">작업 페이지 열기</Link></main>;
}
