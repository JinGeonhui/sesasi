import Link from "next/link";
import { Icon } from "./icons";

const items = [
  { id: "home", label: "홈", href: "/planner/" },
  { id: "settings", label: "설정", href: "/planner/settings/" },
] as const;

export default function PlannerNavigation({ active }: { active: typeof items[number]["id"] }) {
  return <header className="db-bar">
    <Link className="db-brand" href="/planner/" aria-label="작업 페이지 홈">Daybook</Link>
    <nav className="db-nav" aria-label="작업 페이지 메뉴">{items.map(item =>
      <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined}><Icon name={item.id} size={21}/><span>{item.label}</span></Link>
    )}</nav>
    <Link href="/film/" className="db-return"><Icon name="prev" size={15}/>필름 보기</Link>
  </header>;
}
