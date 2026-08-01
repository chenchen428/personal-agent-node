"use client";

import { useState } from "react";
import { CheckCircle2, PackageCheck } from "lucide-react";
import type { AgentPublicProfile } from "./types";

export function AgentDeliverySystem({ profile }: { profile: AgentPublicProfile }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = profile.workflow[selectedIndex] || profile.workflow[0];
  const terminal = selectedIndex === profile.workflow.length - 1;
  const pageReview = selected?.surface === "page";
  return <div className="agent-delivery-system">
    <section className="agent-workflow">
      <h3>阶段工作流</h3>
      <ol>{profile.workflow.map((item, index) => <li key={`${item.step || index}-${item.title}`}>
        <button aria-pressed={index === selectedIndex} onClick={() => setSelectedIndex(index)} type="button">
          <span>{item.step || String(index + 1).padStart(2, "0")}</span>
          <div><strong>{item.title}</strong><p>{item.description}</p></div>
        </button>
      </li>)}</ol>
      {selected ? <aside className="agent-workflow-gate" aria-live="polite">
        <small>{terminal ? "DELIVERY STATE" : pageReview ? "PAGE REVIEW" : "TEXT REVIEW"}</small>
        <strong>{terminal ? "交付终态" : `${pageReview ? "通过 Page" : "通过消息"}确认 · ${selected.title}`}</strong>
        <p>{terminal ? "最终进度 Page 同步后进入终态，后续修改仍会创建新版本。" : pageReview ? "本阶段产物先发布为适合手机查看的私有 Page，用户确认必须绑定实际审阅的 Page；进度 Page 同步前不能继续。" : "本阶段只确认简短文字。用户明确回复后更新同一进度 Page，再进入下一阶段。"}</p>
      </aside> : null}
    </section>
    <section className="agent-deliverables">
      <h3>其他交付类型</h3>
      <div>{profile.deliverables.map((item) => <article key={item.title}><PackageCheck aria-hidden="true" /><span><strong>{item.title}</strong><p>{item.description}</p></span></article>)}</div>
    </section>
    <section className="agent-acceptance">
      <h3>验收标准</h3>
      <div>{profile.acceptance.map((item) => <p key={item}><CheckCircle2 aria-hidden="true" />{item}</p>)}</div>
    </section>
  </div>;
}
