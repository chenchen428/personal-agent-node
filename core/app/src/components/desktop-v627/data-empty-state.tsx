import Link from "next/link";
import { IllustratedEmptyState } from "../desktop-v72/illustrated-empty-state";

type DataEmptyStateProps = {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  illustrated?: boolean;
};

export function DataEmptyState({ title, description, actionHref, actionLabel, illustrated = false }: DataEmptyStateProps) {
  const action = actionHref && actionLabel ? <Link className="data-empty-action" href={actionHref}>{actionLabel}</Link> : null;
  if (illustrated) return <IllustratedEmptyState className="data-empty-state" variant="data" title={title} description={description}>{action}</IllustratedEmptyState>;
  return <div className="data-empty-state" role="status">
    <strong>{title}</strong>
    <p>{description}</p>
    {action}
  </div>;
}
