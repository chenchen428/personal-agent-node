"use client";

import { useEffect, useState } from "react";
import { AppWindow, ArrowUpRight } from "lucide-react";

type PersonalApp = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  route: string;
  compatible: boolean;
};

export function AppsDashboard() {
  const [apps, setApps] = useState<PersonalApp[] | null>(null);

  useEffect(() => {
    fetch("/api/system/apps", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("catalog unavailable")))
      .then((value) => setApps((value.apps || []).filter((app: PersonalApp) => app.compatible && app.route)))
      .catch(() => setApps([]));
  }, []);

  if (apps === null) {
    return <section className="apps-empty"><AppWindow className="size-6" /><strong>正在读取应用</strong><span>请稍候…</span></section>;
  }

  if (apps.length === 0) {
    return <section className="apps-empty"><AppWindow className="size-6" /><strong>还没有可用应用</strong><span>Agent 创建应用后会出现在这里。</span></section>;
  }

  return (
    <section className="apps-catalog" aria-label="我的应用">
      {apps.map((app, index) => (
        <a className="apps-card" href={app.route} key={app.id}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><ArrowUpRight className="size-4" /></header>
          <div className="apps-card-mark"><AppWindow className="size-5" /></div>
          <h2>{app.name}</h2>
          <p>{app.description || "打开应用"}</p>
          <footer><span>{app.version || "本地应用"}</span><span>打开</span></footer>
        </a>
      ))}
    </section>
  );
}
