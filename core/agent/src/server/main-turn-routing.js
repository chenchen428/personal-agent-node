export function isTaskStatusRequest(content) {
  const text = String(content || "").trim();
  if (!text) return false;
  // Only consume an unambiguous status-only question. Mixed requests must reach
  // the Agent intact so a request to finish or deliver something is not lost.
  const clauses = text.split(/[？?。！!，,；;\n]+/u).map((part) => part.trim()).filter(Boolean);
  return clauses.length > 0 && clauses.every((part) => /^(?:(?:请|麻烦)?(?:帮我)?(?:看一下|看下|查一下|查下|告诉我|只返回)\s*)?(?:(?:现在|目前|当前|刚才|这个|那个|上个|任务|工作|处理|的)\s*)*(?:进度|状态|做到哪(?:一?步)?|处理到哪(?:一?步)?|完成了吗|完成没有|怎么样了|还要多久)(?:了|呢|如何|怎么样|是什么)?$/u.test(part));
}

export function formatTaskStatusReply(children) {
  const tasks = (Array.isArray(children) ? children : [])
    .filter((task) => task && task.status !== "archived")
    .slice(0, 5);
  if (!tasks.length) return "当前没有可报告的任务。";
  const lines = tasks.map((task) => {
    const title = String(task.title || "未命名任务").trim().replace(/[\\[\]`*_<>]/g, "\\$&");
    const state = taskStatusLabel(task.status);
    const progress = taskProgressReference(task);
    return `“${title}”当前状态：${state}。${progress ? ` ${progress}` : ""}`;
  });
  return lines.join("\n");
}

function taskProgressReference(task) {
  try {
    const url = new URL(String(task.url || ""));
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && !["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname)
      && /^\/app\/mobile\/workers\/[^/]+$/.test(url.pathname)
      && (!task.id || url.pathname === `/app/mobile/workers/${encodeURIComponent(task.id)}`)) {
      return `[查看进度](${url.href.replaceAll("(", "%28").replaceAll(")", "%29")})`;
    }
  } catch {}
  return task.linkNotice ? String(task.linkNotice) : "";
}

function taskStatusLabel(status) {
  if (status === "start" || status === "running") return "处理中";
  if (status === "idle") return "本次处理已结束，是否完整交付以结果为准";
  if (status === "paused") return "未完成，需要继续处理";
  return "状态未知";
}
