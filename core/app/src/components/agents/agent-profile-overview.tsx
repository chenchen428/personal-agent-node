import { Check, ChevronRight, CircleOff, ClipboardList } from "lucide-react";
import type { AgentPublicProfile } from "./types";

export function AgentProfileOverview({ profile }: { profile: AgentPublicProfile }) {
  return <div className="agent-profile-overview">
    <section>
      <h3>核心能力</h3>
      <div className="agent-capability-list">{profile.capabilities.map((item) => <article key={item.title}><Check aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.description}</p></div></article>)}</div>
    </section>
    <div className="agent-scope-columns">
      <ScopeGroup icon={Check} items={profile.useWhen} title="适合使用" tone="positive" />
      <ScopeGroup icon={CircleOff} items={profile.notFor} title="不适合" tone="boundary" />
      <ScopeGroup icon={ClipboardList} items={profile.requiredInputs} title="需要输入" tone="input" />
    </div>
    {profile.limitations.length ? <aside className="agent-limitations"><strong>限制</strong><div>{profile.limitations.map((item) => <span key={item}>{item}</span>)}</div></aside> : null}
  </div>;
}
function ScopeGroup({ icon: Icon, items, title, tone }: {
  icon: typeof Check;
  items: string[];
  title: string;
  tone: "boundary" | "input" | "positive";
}) {
  return <section className={`agent-scope-group is-${tone}`}><h3><Icon aria-hidden="true" />{title}</h3><div>{items.map((item) => <p key={item}><ChevronRight aria-hidden="true" />{item}</p>)}</div></section>;
}
