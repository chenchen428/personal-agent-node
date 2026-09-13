import Link from "next/link";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

type HeaderItem = { label: string; href?: string };

export function DesktopHeaderBreadcrumb({ pathname, currentLabel }: {
  pathname: string;
  currentLabel: string;
}) {
  const items = headerItems(pathname, currentLabel);
  return <Breadcrumb className="v72-header-breadcrumb" aria-label="当前位置">
    <BreadcrumbList>{items.map((item, index) => <Fragment key={`${item.href || "current"}-${item.label}`}>
      {index > 0 ? <BreadcrumbSeparator /> : null}
      <BreadcrumbItem>{item.href ? <Link href={item.href}>{item.label}</Link> : <BreadcrumbPage title={item.label}>{item.label}</BreadcrumbPage>}</BreadcrumbItem>
    </Fragment>)}</BreadcrumbList>
  </Breadcrumb>;
}

function headerItems(pathname: string, currentLabel: string): HeaderItem[] {
  if (["/app/workers/schedules", "/app/workers/plans"].includes(pathname)) return [{ label: "日程" }];
  if (["/app/calendar", "/app/workers/calendar"].includes(pathname)) return [{ label: "日程" }];
  if (pathname === "/app/workers") return drilldown("日程", "/app/workers/calendar", "执行记录");
  if (pathname === "/app/connections/wechat-personal") return drilldown("连接", "/app/connections", "个人微信");
  if (pathname === "/app/settings/memory") return drilldown("空间设置", "/app/settings", "记忆");
  if (pathname === "/app/skills") return drilldown("空间设置", "/app/settings", "技能");

  if (/^\/app\/pages\/[^/]+$/.test(pathname)) return drilldown("发布页", "/app/pages", "页面详情");
  return [{ label: currentLabel }];
}

function drilldown(parentLabel: string, parentHref: string, currentLabel: string): HeaderItem[] {
  return [{ label: parentLabel, href: parentHref }, { label: currentLabel }];
}
