export function TemplatePreviewLoading() {
  return <div className="template-preview-loading" aria-label="正在准备 3D 预览" aria-live="polite">
    <div aria-hidden="true"><i /><i /><i /><i /></div>
    <span>PREPARING 3D SPACE</span>
    <strong>正在构建完整空间</strong>
    <p>读取户型、家具与材质关系</p>
    <em><b /></em>
  </div>;
}
