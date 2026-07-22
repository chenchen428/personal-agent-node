const groups = [
  { title: "空间结构", items: ["拆除餐厅右侧、生活阳台下方卧室的非承重隔墙", "该卧室并入公共区，形成大客厅", "左下角靠凸窗卧室保留", "墙厚约 220mm，实施前复核结构条件"] },
  { title: "生活习惯", items: ["满足六人就餐与多人会客", "生活阳台保留洗烘与家政收纳", "书房兼顾日常办公和临时客房"] },
  { title: "设计偏好", items: ["现代温润，减少高饱和装饰", "南向阳台保持通透，强化落地窗", "SU 设计稿需标清门窗、柜体和关键净宽"] },
];

const history = [
  { version: "R7", date: "07.21", note: "纠正拆除对象为餐厅右侧、生活阳台下方卧室" },
  { version: "R6", date: "07.20", note: "确认卧室并入公共区，合并为大客厅" },
  { version: "R5", date: "07.19", note: "补充六人餐桌和书房复合使用" },
];

export function InteriorTemplateRequirements() {
  return <section className="interior-requirements-view">
    <header><div><span>AGENT REQUIREMENT DIGEST</span><h2>用户需求核心点</h2></div><strong>R7 · 2026.07.20</strong></header>
    <p>拆除餐厅右侧、生活阳台下方卧室的非承重隔墙，把该卧室并入公共区形成大客厅；保留左下角靠凸窗卧室，墙厚约 220mm，实施前复核结构条件。</p>
    <div className="interior-requirement-groups">{groups.map((group) => <section key={group.title}><h3>{group.title}</h3><ul>{group.items.map((item) => <li key={item}>✓ {item}</li>)}</ul></section>)}</div>
    <aside className="interior-requirement-history"><b>迭代脉络</b>{history.map((item) => <span key={item.version}><strong>{item.version}</strong>{item.note}<time>{item.date}</time></span>)}</aside>
  </section>;
}
