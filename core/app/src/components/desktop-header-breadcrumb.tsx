import Link from "next/link";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

type HeaderItem = { label: string; href?: string };

export function DesktopHeaderBreadcrumb({ pathname, currentLabel, currentAppName }: {
  pathname: string;
  currentLabel: string;
  currentAppName?: string;
}) {
  const items = headerItems(pathname, currentLabel, currentAppName);
  return <Breadcrumb className="v72-header-breadcrumb" aria-label="当前位置">
    <BreadcrumbList>{items.map((item, index) => <Fragment key={`${item.href || "current"}-${item.label}`}>
      {index > 0 ? <BreadcrumbSeparator /> : null}
      <BreadcrumbItem>{item.href ? <Link href={item.href}>{item.label}</Link> : <BreadcrumbPage title={item.label}>{item.label}</BreadcrumbPage>}</BreadcrumbItem>
    </Fragment>)}</BreadcrumbList>
  </Breadcrumb>;
}

function headerItems(pathname: string, currentLabel: string, currentAppName?: string): HeaderItem[] {
  if (pathname === "/app/workers/schedules") return drilldown("任务", "/app/workers", "自动化");
  if (pathname === "/app/connections/wechat-personal") return drilldown("连接", "/app/connections", "个人微信");
  if (pathname === "/app/settings/memory") return drilldown("空间设置", "/app/settings", "记忆");
  if (pathname === "/app/skills") return drilldown("空间设置", "/app/settings", "技能");

  if (/^\/app\/agents\/[^/]+$/.test(pathname)) return drilldown("Agent 团队", "/app/agents", "成员详情");
  if (/^\/app\/pages\/[^/]+$/.test(pathname)) return drilldown("发布页", "/app/pages", "页面详情");
  if (/^\/app\/apps\/[^/]+$/.test(pathname)) return drilldown("全部应用", "/app/apps", currentAppName || "应用详情");
  return [{ label: currentLabel }];
}

function drilldown(parentLabel: string, parentHref: string, currentLabel: string): HeaderItem[] {
  return [{ label: parentLabel, href: parentHref }, { label: currentLabel }];
}
