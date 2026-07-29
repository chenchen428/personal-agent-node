import Link from "next/link";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { findPageTemplate } from "@/components/page-templates/catalog";

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
  if (pathname === "/app/pages/templates") return drilldown("发布页", "/app/pages", "模板");
  if (pathname === "/app/settings/memory") return drilldown("空间设置", "/app/settings", "记忆");
  if (pathname === "/app/skills") return drilldown("空间设置", "/app/settings", "技能");

  const templatePrefix = "/app/pages/templates/";
  if (pathname.startsWith(templatePrefix)) {
    const templateId = safelyDecode(pathname.slice(templatePrefix.length).split("/")[0]);
    const template = findPageTemplate(templateId);
    return [
      { label: "发布页", href: "/app/pages" },
      { label: "模板", href: "/app/pages/templates" },
      { label: template?.name || "模板详情" },
    ];
  }

  if (/^\/app\/pages\/[^/]+$/.test(pathname)) return drilldown("发布页", "/app/pages", "页面详情");
  if (/^\/app\/apps\/[^/]+$/.test(pathname)) return drilldown("全部应用", "/app/apps", currentAppName || "应用详情");
  return [{ label: currentLabel }];
}

function drilldown(parentLabel: string, parentHref: string, currentLabel: string): HeaderItem[] {
  return [{ label: parentLabel, href: parentHref }, { label: currentLabel }];
}

function safelyDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
