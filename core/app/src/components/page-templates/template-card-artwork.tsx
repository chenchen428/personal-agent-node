export function TemplateCardArtwork({ coverPath }: { coverPath: string }) {
  return <div className="template-card-artwork" aria-label="装修设计交付页 Pascal 专业模型截图">
    <img alt="由内置 Pascal v2 项目生成的专业概念模型平面封面" decoding="async" fetchPriority="high" loading="eager" src={coverPath} />
    <span className="template-artwork-live"><i />Pascal 模型</span>
    <footer><span>装修设计交付页</span><b>真实产物</b></footer>
  </div>;
}
