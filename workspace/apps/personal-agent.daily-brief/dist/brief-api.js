const APP_ID = "personal-agent.daily-brief";
const APP_HEADERS = { "x-personal-agent-app-id": APP_ID };

export async function loadBrief({ record }) {
  const [mailResult, pagesResult, dataResult, historyResult] = await Promise.all([
    nodeApi("/api/node/v1/mail/messages"),
    nodeApi("/api/node/v1/pages"),
    nodeApi("/api/node/v1/data/schema"),
    nodeApi(`/api/node/v1/apps/${APP_ID}/history?limit=8`, { headers: APP_HEADERS }),
  ]);
  const brief = {
    mail: normalizeMail(mailResult),
    pages: Array.isArray(pagesResult.assets) ? pagesResult.assets : [],
    objects: Array.isArray(dataResult.objects) ? dataResult.objects : [],
    history: Array.isArray(historyResult.items) ? historyResult.items : [],
    query: null,
  };
  brief.query = brief.objects[0] ? await queryFirstObject(brief.objects[0].name) : null;

  if (record || brief.history.length === 0) {
    await appendHistory(brief, record ? "refresh" : "summary", record ? "刷新今日简报" : "完成首次汇总");
    const refreshed = await nodeApi(`/api/node/v1/apps/${APP_ID}/history?limit=8`, { headers: APP_HEADERS });
    brief.history = Array.isArray(refreshed.items) ? refreshed.items : [];
  }
  return brief;
}

async function appendHistory(brief, kind, title) {
  const summary = `${brief.mail.length} 封邮件、${brief.objects.length} 个共享数据对象和 ${brief.pages.length} 个发布页已整理。`;
  await nodeApi(`/api/node/v1/apps/${APP_ID}/history`, {
    method: "POST",
    headers: { ...APP_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ kind, title, summary, sources: ["mail", "data", "pages"] }),
  });
}

async function queryFirstObject(object) {
  try {
    return await nodeApi("/api/node/v1/data/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object, page: { number: 1, size: 3 } }),
    });
  } catch {
    return null;
  }
}

async function nodeApi(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.ok !== true) throw new Error(value?.error?.message || `读取失败（${response.status}）`);
  return value.result;
}

function normalizeMail(result) {
  for (const key of ["events", "messages", "items"]) if (Array.isArray(result?.[key])) return result[key];
  return [];
}
