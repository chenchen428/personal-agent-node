import registry from "../../../../../registry/page-templates.json";

export type PageTemplate = {
  id: string;
  name: string;
  category: string;
  skill: string;
  status: "built-in";
  summary: string;
  desktop: boolean;
  mobileLandscape: boolean;
  implementation: {
    version: number;
    generator: string;
    artifactMarker: string;
  };
  exampleArtifact: {
    source: string;
    pagePath: string;
    manifestPath: string;
    coverPath: string;
  };
  acceptance: {
    visualOwner: "user";
    agentBrowserReview: false;
  };
  publicationContract: {
    verifyArtifactBeforePublish: true;
    persistProvenance: true;
  };
  fixedFramework: string[];
  agentFreedom: string[];
  presentation?: PageTemplatePresentation;
};

export const pageTemplates = registry.templates as PageTemplate[];

export function findPageTemplate(id: string) {
  return pageTemplates.find((template) => template.id === id);
}

export type PageTemplatePresentation = {
  coverAlt: string;
  coverBadge: string;
  coverFooter: string;
  detailHeading: string;
  detailDescription: string;
  principleTitle: string;
  principleDescription: string;
  webEyebrow: string;
  webLabel: string;
  mobileEyebrow: string;
  mobileLabel: string;
  previewTitle: string;
};

const interiorPresentation: PageTemplatePresentation = {
  coverAlt: "由内置 Pascal v2 项目生成的专业装修概念模型轴测封面",
  coverBadge: "Pascal 模型",
  coverFooter: "装修设计交付页",
  detailHeading: "从装修证据到可追溯的 Pascal 专业概念模型",
  detailDescription: "把脱敏户型依据、需求优先级、A/B 方案、真实门窗开洞、多层构件、质量审计和专业核验边界放进同一份离线交付，并保留每次 revision 的调整依据。",
  principleTitle: "用户原图是唯一户型依据",
  principleDescription: "Agent 标注、Pascal 3D、正交平面、空间标签和方案说明都由同一张用户上传图生成，并通过来源哈希校验。",
  webEyebrow: "VERIFIED GENERATED PAGE",
  webLabel: "Web · Pascal v2 流水线真实产物",
  mobileEyebrow: "MOBILE GENERATED PAGE",
  mobileLabel: "移动端 · 横屏交付产物",
  previewTitle: "Pascal v2 装修设计交付页",
};

export function presentationFor(template: PageTemplate): PageTemplatePresentation {
  return template.presentation || interiorPresentation;
}
