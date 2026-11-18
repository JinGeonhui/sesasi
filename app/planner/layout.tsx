import type { ReactNode } from "react";
import "./planner.css";
import AuthGate from "./auth-gate";
import { DiscordSync } from "./discord-sync";

export default function PlannerLayout({ children }: { children: ReactNode }) {
  return <AuthGate><DiscordSync/>{children}</AuthGate>;
}
