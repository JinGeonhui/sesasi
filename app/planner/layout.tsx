import type { ReactNode } from "react";
import "./planner.css";
import { CloudNotice } from "./cloud-account";
import { DiscordSync } from "./discord-sync";

export default function PlannerLayout({ children }: { children: ReactNode }) {
  return <><CloudNotice/><DiscordSync/>{children}</>;
}
