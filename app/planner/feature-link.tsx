import Link from "next/link";
import { Icon, type IconName } from "./icons";

export default function FeatureLink({ href, icon, title, description }: {
  href: string;
  icon: IconName;
  title: string;
  description: string;
}) {
  return <Link className="db-feature-link" href={href}>
    <span className="db-link-icon"><Icon name={icon} size={22}/></span>
    <span className="db-link-copy"><strong>{title}</strong><span className="db-link-description">{description}</span></span>
    <span className="db-link-arrow"><Icon name="next" size={16}/></span>
  </Link>;
}
