import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "세사시 — 나를 이루는 순간들",
  description: "점에서 선으로, 순간에서 이야기로. 삶과 작업의 장면들을 이어가는 개인 기록 공간.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="ko"><body>{children}</body></html>;
}
