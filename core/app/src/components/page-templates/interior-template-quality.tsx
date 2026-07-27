const checks = [
  { title: "空间与通行", detail: "OBB 碰撞、门窗净空和 0.25m 可行走网格通过", tone: "passed" },
  { title: "需求追踪", detail: "8/8 must 已关联到场景节点或验证结果", tone: "passed" },
  { title: "预算置信度", detail: "当前为概念级分配，采购前仍需标准化报价", tone: "warning" },
];

const boundaries = [
  "所有施工尺寸需现场复测",
  "隔墙属性与拆改范围需结构专业人员确认",
  "防水、电气与消防按所在地要求深化",
];

export function InteriorTemplateQuality() {
  return <section className="interior-requirements-view interior-quality-view">
    <header><div><span>PROFESSIONAL QUALITY GATE</span><h2>确定性审计与专业边界</h2></div><strong>0 阻断 · 1 警告</strong></header>
    <p>当前 revision 已通过自动模型门禁，但仍是概念设计；专业核验项不会被自动标记为合规。</p>
    <div className="interior-requirement-groups">
      {checks.map((check) => <section data-tone={check.tone} key={check.title}><h3>{check.title}</h3><ul><li>{check.tone === "passed" ? "✓" : "!"} {check.detail}</li></ul></section>)}
    </div>
    <aside className="interior-requirement-history"><b>需专业核验</b>{boundaries.map((item, index) => <span key={item}><strong>{String(index + 1).padStart(2, "0")}</strong>{item}</span>)}</aside>
  </section>;
}
