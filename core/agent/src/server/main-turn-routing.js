import { inspectPageTemplate, listPageTemplates } from "../online-pages/template-catalog.js";

const PAGE_DELIVERY_PATTERN = /(?:\bpage\b|页面|网页|交付页|可交互|交互式|\b3d\b|sketchup|su\s*设计稿)/i;
const PAGE_ACTION_PATTERN = /(?:帮我|给我|我要|我想要|我需要|请|立即|现在)?[^\n]{0,10}(?:做|制作|生成|创建|新建|开始|搭建|实现|重做|重新做|改一下|修改|更新)/i;
const TEMPLATE_INFO_PATTERN = /(?:(?:有哪些|有什么|是什么|怎么用|如何用|可用吗|是否可用|介绍|列表|查看|查询)[^\n]{0,10}(?:模板|\bpage\b|页面)|(?:模板|\bpage\b|页面)[^\n]{0,10}(?:有哪些|有什么|是什么|怎么用|如何用|可用吗|是否可用|介绍|列表|查看|查询))/i;

export function isTaskStatusRequest(content) {
  const text = String(content || "").trim();
  if (!text) return false;
  return /(?:现在|目前|刚才|这个|那个|上个|任务|工作|处理)[^\n]{0,24}(?:进度|状态|做到哪|处理到哪|完成了吗|完成没有|怎么样了|还要多久)/i.test(text)
    || /(?:做到哪|处理到哪|完成了吗|完成没有|任务状态|任务进度|当前状态|当前进度|还要多久)/i.test(text);
}

export function matchPageTemplateRequest(content) {
  const text = String(content || "").trim();
  if (!text || isTaskStatusRequest(text) || TEMPLATE_INFO_PATTERN.test(text)) return null;
  if (!PAGE_DELIVERY_PATTERN.test(text) || !PAGE_ACTION_PATTERN.test(text)) return null;

  const candidates = listPageTemplates()
    .map((summary) => ({
      summary,
      score: summary.matchTerms.reduce((total, term) => total + (includesNormalized(text, term) ? 1 : 0), 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.summary.id.localeCompare(right.summary.id));
  if (!candidates.length) return null;
  return inspectPageTemplate(candidates[0].summary.id);
}

export function buildPageTemplateTask({ request, template }) {
  const originalRequest = String(request || "").trim();
  const contract = {
    id: template.id,
    name: template.name,
    category: template.category,
    skill: template.skill,
    useWhen: template.useWhen,
    matchTerms: template.matchTerms,
    fixedFramework: template.fixedFramework,
    agentFreedom: template.agentFreedom,
    agentInstructions: template.agentInstructions,
    desktop: Boolean(template.desktop),
    mobileLandscape: Boolean(template.mobileLandscape),
  };
  return [
    "用户原始请求：",
    originalRequest,
    "",
    "必须使用下面的内置 Page 模板契约完成任务：",
    JSON.stringify(contract, null, 2),
    "",
    `先调用并严格遵循 ${template.skill} 技能，再开始任何页面实现。`,
    "完整保留 fixedFramework，只在 agentFreedom 范围内根据用户材料调整内容。",
    "用户材料不足时先明确列出缺失项，不得用模板示例或虚构户型替代用户方案。",
    "完成后把当前状态、结论和真实产物返回主 Agent。",
  ].join("\n");
}

export function formatTaskStatusReply(children) {
  const tasks = (Array.isArray(children) ? children : [])
    .filter((task) => task && task.status !== "archived")
    .slice(0, 5);
  if (!tasks.length) return "当前没有可报告的任务。";
  const lines = tasks.map((task) => {
    const title = String(task.title || "未命名任务").trim();
    const state = taskStatusLabel(task.status);
    return `“${title}”当前状态：${state}。`;
  });
  return lines.join("\n");
}

function includesNormalized(content, term) {
  return String(content).toLocaleLowerCase().includes(String(term || "").trim().toLocaleLowerCase());
}

function taskStatusLabel(status) {
  if (status === "start" || status === "running") return "处理中";
  if (status === "idle") return "已完成";
  if (status === "paused") return "未完成，需要继续处理";
  return "状态未知";
}
