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
  fixedFramework: string[];
  agentFreedom: string[];
};

export const pageTemplates = registry.templates as PageTemplate[];

export function findPageTemplate(id: string) {
  return pageTemplates.find((template) => template.id === id);
}
