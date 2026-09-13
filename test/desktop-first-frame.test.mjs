import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

test("desktop menu first frames render prefetched real content, including initially selected details", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const compiled = await build({ absWorkingDir: root, tsconfig: "core/app/tsconfig.json",
    stdin: { resolveDir: root, contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { prefetchDesktopData, getPrefetchError, readPrefetched } from './core/app/src/lib/desktop-prefetch';
      import { clientResourceCache } from './core/app/src/lib/client-resource-cache';
      import { MailPage } from './core/app/src/components/desktop-v627/mail-page';
      import { WorkersPage } from './core/app/src/components/desktop-v627/workers-page';
      import { DataPage } from './core/app/src/components/desktop-v627/data-page';
      import { ConversationPage } from './core/app/src/components/desktop-v627/conversation-page';
      import { TokenUsagePage } from './core/app/src/components/desktop-v627/token-usage-page';
      import { RuntimePage } from './core/app/src/components/desktop-v627/runtime-page';
      import { UpdatePage } from './core/app/src/components/desktop-v627/update-page';
      const profile = { mode: 'account', model: 'fixture-model', reasoningEffort: 'medium', baseUrl: '', authType: 'api-key', credentialConfigured: false };
      const session = { id: 'worker-fixture', title: '已准备的任务', role: 'worker', status: 'done', updatedAt: '2026-09-13T12:00:00Z', messages: [{id:'m1', role:'assistant',content:'任务详情已经准备完成',createdAt:'2026-09-13T12:00:00Z'}] };
      const mail = { id: 'mail-fixture', title: '已准备的邮件', sender: { displayName:'联系人', address:'sender@example.test' }, receivedAt:'2026-09-13T12:00:00Z', matched:true, payload:{ recipients:['owner@example.test'],textPreview:'邮件正文已经准备完成',attachments:[] } };
      const values = {
        '/api/chat/sessions?limit=50': { sessions:[session] },
        '/api/chat/sessions/worker-fixture': { session },
        '/api/chat/desktop/conversation?limit=40': { session:{ ...session, role:'main', title:'与 Cove 的对话' } },
        '/api/app/mail/messages': { events:[mail],total:1,selectedEvent:mail,selectedRuns:[],content:null },
        '/api/app/data/schema?counts=0&preview=1': { objects:[{name:'账单',rowCount:1}],metadata:[],initialResult:{columns:['项目'],rows:[{'项目':'已准备的数据'}],page:{number:1,totalRows:1,totalPages:1}} },
        '/api/token-usage?range=7d': { tokenUsage:{ inputTokens:123,cachedInputTokens:0,outputTokens:12,reasoningOutputTokens:0,totalTokens:135,sessionCount:1,requestCount:1,cacheRate:0,updatedAt:null,range:'7d',dailyUsage:[],recentSessions:[] } },
        '/api/node/v1/client/runtime': { version:'fixture-version',state:'running',uptimeSeconds:3600,workspaceRoot:'' },
        '/api/system/agent-runtime': { schemaVersion:1,spaceId:'fixture',revision:1,engine:'codex',profiles:{codex:profile,'claude-code':profile} },
        '/api/system/update': {current:{version:'fixture-version',releaseId:'fixture'},channel:'beta',checkedAt:null,updateAvailable:false},
        '/api/system/authorization': {mode:'confirm'},
        '/api/app/schedules/tasks': {tasks:[]}
      };
      export async function run() {
        const savedWindow = globalThis.window, savedFetch = globalThis.fetch;
        globalThis.window = Object.assign(new EventTarget(), {location:{pathname:'/app'}});
        clientResourceCache.bind('fixture-space');
        let active=0, maximum=0, calls=0;
        globalThis.fetch = async (url, init) => {
          active++; calls++; maximum=Math.max(maximum,active);
          await new Promise(resolve => setTimeout(resolve,1)); active--;
          if (url === '/api/system/agent-runtime' && init.headers?.['x-personal-agent-surface'] !== 'desktop') throw new Error('missing desktop surface');
          return Response.json(values[url] ?? { ok:false,error:'fixture unavailable' }, { status: values[url] ? 200 : 503 });
        };
        try {
          await prefetchDesktopData();
          const html = Object.fromEntries(Object.entries({ mail:MailPage,workers:WorkersPage,data:DataPage,conversation:ConversationPage,token:TokenUsagePage,runtime:RuntimePage,update:UpdatePage }).map(([name, Component])=>[name,renderToStaticMarkup(React.createElement(Component))]));
          const failure=getPrefetchError('/api/skills');
          clientResourceCache.bind('different-space');
          const cleared=readPrefetched('/api/app/mail/messages')===null && getPrefetchError('/api/skills')==='';
          let abortCalls=0;
          globalThis.fetch=(_url,init)=>new Promise((_resolve,reject)=>{abortCalls++;init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
          const pending=prefetchDesktopData(); clientResourceCache.bind('third-space'); await pending;
          const abortedWithoutLeak=abortCalls===4 && clientResourceCache.size===0 && getPrefetchError('/api/skills')==='';
          const originalTimer=globalThis.setTimeout;
          globalThis.setTimeout=(fn,delay,...args)=>originalTimer(fn,delay===8000?10:delay,...args);
          try { await prefetchDesktopData(); }
          finally { globalThis.setTimeout=originalTimer; }
          const deadlineFailed=getPrefetchError('/api/app/mail/messages');
          return {html,maximum,calls,failure,cleared,abortedWithoutLeak,deadlineFailed};
        } finally { globalThis.window=savedWindow; globalThis.fetch=savedFetch; }
      }
    ` }, platform: "node", format: "cjs", bundle: true, write: false,
    plugins: [{ name: "next-static-render", setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "next-static-render" }));
      builder.onLoad({ filter: /.*/, namespace: "next-static-render" }, ({ path }) => ({ contents: path.endsWith("navigation")
        ? "export const useSearchParams=()=>new URLSearchParams(); export const usePathname=()=>'/app'; export const useRouter=()=>({push(){},replace(){}});"
        : "import React from 'react'; export default function Link({children,...props}){return React.createElement('a',props,children)}", resolveDir: root }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const result = await module.exports.run();
  assert.equal(result.maximum, 4); assert.ok(result.calls >= 20);
  assert.equal(result.failure, "fixture unavailable"); assert.equal(result.cleared, true);
  assert.equal(result.abortedWithoutLeak, true);
  assert.match(result.deadlineFailed, /本机数据暂未就绪/);
  for (const [name, html] of Object.entries(result.html)) {
    assert.doesNotMatch(html, /正在读取|正在准备邮件|正在准备任务|读取中|skeleton|data-loading="true"/, name);
  }
  assert.match(result.html.mail, /邮件正文已经准备完成/);
  assert.match(result.html.workers, /任务详情已经准备完成/);
  assert.match(result.html.data, /已准备的数据/);
  assert.match(result.html.runtime, /fixture-model/);
  assert.match(result.html.update, /fixture-version/);
});
