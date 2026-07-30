import { CheckCircle2, PackageCheck } from "lucide-react";
import type { AgentPublicProfile } from "./types";

export function AgentDeliverySystem({ profile }: { profile: AgentPublicProfile }) {
  return <div className="agent-delivery-system">
    <section className="agent-workflow">
      <h3>工作方法</h3>
      <ol>{profile.workflow.map((item, index) => <li key={`${item.step || index}-${item.title}`}>
        <span>{item.step || String(index + 1).padStart(2, "0")}</span>
        <div><strong>{item.title}</strong><p>{item.description}</p></div>
      </li>)}</ol>
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
