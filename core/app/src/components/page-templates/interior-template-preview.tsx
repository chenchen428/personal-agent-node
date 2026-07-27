"use client";

import { Box, ClipboardList, FileImage, Layers3, RotateCcw, ShieldCheck, Tags } from "lucide-react";
import { useState } from "react";
import { InteriorTemplateCanvas } from "./interior-template-canvas";
import { InteriorTemplatePlan } from "./interior-template-plan";
import { InteriorTemplateRequirements } from "./interior-template-requirements";
import { InteriorTemplateQuality } from "./interior-template-quality";
import type { InteriorView } from "./interior-template-scene";
import { findPageTemplate } from "./catalog";

type Presentation = "model" | "plan" | "requirements" | "quality";
type LevelMode = "stacked" | "exploded" | "solo";
const template = findPageTemplate("interior-design-delivery");
const levelModeLabels: Record<LevelMode, string> = { stacked: "堆叠", exploded: "分解", solo: "单层" };
const nextLevelMode: Record<LevelMode, LevelMode> = { stacked: "exploded", exploded: "solo", solo: "stacked" };

export function InteriorTemplatePreview({ device }: { device: "web" | "mobile" }) {
  const [presentation, setPresentation] = useState<Presentation>("model");
  const [view, setView] = useState<InteriorView>("iso");
  const [labels, setLabels] = useState(true);
  const [levelMode, setLevelMode] = useState<LevelMode>("stacked");
  const [resetKey, setResetKey] = useState(0);
  const reset = () => { setView("iso"); setResetKey((value) => value + 1); };

  return <section
    className={`interior-template-preview device-${device}`}
    aria-label="装修设计交付页实时预览"
    data-template-id={template?.id}
    data-template-version={template?.implementation.version}
  >
    <div className="interior-template-shell">
      <header className="interior-template-header">
        <span className="interior-template-brand"><span className="interior-template-mark">PA</span><b>Pages</b></span>
        <div><small>PERSONAL AGENT · PASCAL PROFESSIONAL</small><strong>C 户型 · 现代温润</strong><em>Revision 7 · Pascal v2 · 连续大客厅</em></div>
        <span className="interior-template-status"><i />质量门禁通过 · 等待用户验收</span>
      </header>
      <div className={`interior-template-stage is-${presentation}`}>
        {presentation === "model" ? <>
          <InteriorTemplateCanvas labels={labels} resetKey={resetKey} view={view} />
          <div className="interior-view-toolbar" role="group" aria-label="Pascal 设计模型查看工具">
            <span className="interior-toolbar-label"><Layers3 aria-hidden="true" />设计层</span>
            <span>1 层</span>
            <button aria-label={`楼层模式：${levelModeLabels[levelMode]}，点击切换`} data-level-mode={levelMode} type="button" onClick={() => setLevelMode(nextLevelMode[levelMode])}>{levelModeLabels[levelMode]}</button>
            <span className="interior-toolbar-label"><Box aria-hidden="true" />视角</span>
            <button className={view === "iso" ? "active" : ""} type="button" onClick={() => setView("iso")}>3D</button>
            <button className={view === "top" ? "active" : ""} type="button" onClick={() => setView("top")}>平面</button>
            <button className={labels ? "active" : ""} aria-label={labels ? "隐藏细节标注" : "显示细节标注"} aria-pressed={labels} type="button" onClick={() => setLabels((value) => !value)}><Tags aria-hidden="true" /></button>
            <button aria-label="复位 Pascal 设计模型" type="button" onClick={reset}><RotateCcw aria-hidden="true" /></button>
          </div>
          <span className="interior-view-hint">拖动旋转 · 缩放 · 平移</span>
        </> : presentation === "plan" ? <InteriorTemplatePlan /> : presentation === "requirements" ? <InteriorTemplateRequirements /> : <InteriorTemplateQuality />}
        <nav className="interior-presentation-switch" aria-label="方案资料切换">
          <button aria-pressed={presentation === "model"} onClick={() => setPresentation("model")} type="button">设计模型</button>
          <button aria-pressed={presentation === "plan"} onClick={() => setPresentation("plan")} type="button"><FileImage aria-hidden="true" />户型依据</button>
          <button aria-pressed={presentation === "requirements"} onClick={() => setPresentation("requirements")} type="button"><ClipboardList aria-hidden="true" />需求</button>
          <button aria-pressed={presentation === "quality"} onClick={() => setPresentation("quality")} type="button"><ShieldCheck aria-hidden="true" />质量</button>
        </nav>
      </div>
    </div>
  </section>;
}
