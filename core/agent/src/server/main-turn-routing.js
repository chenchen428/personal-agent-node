export function isTaskStatusRequest(content) {
  const text = String(content || "").trim();
  if (!text) return false;
  return /(?:现在|目前|刚才|这个|那个|上个|任务|工作|处理)[^\n]{0,24}(?:进度|状态|做到哪|处理到哪|完成了吗|完成没有|怎么样了|还要多久)/i.test(text)
    || /(?:做到哪|处理到哪|完成了吗|完成没有|任务状态|任务进度|当前状态|当前进度|还要多久)/i.test(text);
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

function taskStatusLabel(status) {
  if (status === "start" || status === "running") return "处理中";
  if (status === "idle") return "已完成";
  if (status === "paused") return "未完成，需要继续处理";
  return "状态未知";
}
