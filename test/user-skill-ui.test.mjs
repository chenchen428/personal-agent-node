import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { readSkillUpload } from "../core/app/src/components/skills/skill-upload.ts";
import { canManageSkillsOnClient } from "../core/app/src/components/skills/use-skill-management-access.ts";

test("management controls remain read-only outside the local desktop", () => {
  assert.equal(canManageSkillsOnClient("127.0.0.1", "Windows desktop"), true);
  assert.equal(canManageSkillsOnClient("private.example.test", "Windows desktop"), false);
  assert.equal(canManageSkillsOnClient("127.0.0.1", "iPhone"), false);
  assert.equal(canManageSkillsOnClient("localhost", "Macintosh", true), false);
});

test("single skill and folder selection preserve relative resource paths and reject unreadable bundles", async () => {
  const manifest = new File(["---\nname: example\ndescription: test\n---\nInstructions"], "SKILL.md");
  assert.equal((await readSkillUpload([manifest]))[0].path, "SKILL.md");
  const folderManifest = new File(["Instructions"], "SKILL.md"); Object.defineProperty(folderManifest, "webkitRelativePath", { value: "folder/SKILL.md" });
  const resource = new File(["Notes"], "guide.md"); Object.defineProperty(resource, "webkitRelativePath", { value: "folder/references/guide.md" });
  assert.deepEqual((await readSkillUpload([folderManifest, resource])).map(file => file.path), ["SKILL.md", "references/guide.md"]);
  await assert.rejects(() => readSkillUpload([resource]), /根目录含有 SKILL.md/);
  await assert.rejects(() => readSkillUpload([new File([new Uint8Array([255, 254])], "SKILL.md")]), /UTF-8/);
  await assert.rejects(() => readSkillUpload([new File(["x".repeat(512 * 1024 + 1)], "SKILL.md")]), /512KB/);
});

test("skills UI offers import and a real target-bound remove only for ordinary user skills", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const compiled = await build({ absWorkingDir: root, tsconfig: "core/app/tsconfig.json", platform: "node", format: "cjs", bundle: true, write: false,
    stdin: { resolveDir: root, contents: `
      import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {SkillsPage} from './core/app/src/components/desktop-v627/skills-page';
      import {SkillImportDialog} from './core/app/src/components/skills/skill-import-dialog';
      import {SkillRemoveDialog} from './core/app/src/components/skills/skill-remove-dialog';
      const skill={id:'user:skills/example',name:'example',description:'整理笔记',category:'user',source:{kind:'user'},status:'available',management:{removable:true,name:'example',digest:'a'.repeat(64)}};
      globalThis.skillFixture=skill;globalThis.skillManagementAllowed=true;
      const render=()=>renderToStaticMarkup(React.createElement(SkillsPage));
      export const result={user:render(),import:renderToStaticMarkup(React.createElement(SkillImportDialog,{spaceName:'当前空间',onClose(){},onImported:async()=>{}})),remove:renderToStaticMarkup(React.createElement(SkillRemoveDialog,{skill,spaceName:'当前空间',onClose(){},onRemoved:async()=>{}}))};
      globalThis.skillFixture={...skill,source:{kind:'builtin'}};result.builtin=render();
      globalThis.skillFixture={...skill,management:{removable:false}};result.linked=render();
      globalThis.skillFixture=skill;globalThis.skillManagementAllowed=false;result.remote=render();
    ` }, plugins: [{ name: "skill-data", setup(builder) {
      builder.onResolve({ filter: /\/use-skill-management-access$/ }, ({ path }) => ({ path, namespace: "skill-access" }));
      builder.onLoad({ filter: /.*/, namespace: "skill-access" }, () => ({ contents: "export function useSkillManagementAccess(){return globalThis.skillManagementAllowed}", resolveDir: root }));
      builder.onResolve({ filter: /^\.\/shared$/ }, ({ path }) => ({ path, namespace: "skill-data" }));
      builder.onLoad({ filter: /.*/, namespace: "skill-data" }, () => ({ contents: "export function useJson(url){return {value:url.includes('authorization')?{mode:'confirm'}:{skills:[globalThis.skillFixture],categories:[],space:{displayName:'当前空间'}},loading:false,error:'',refresh:async()=>{}}}", resolveDir: root }));
      builder.onResolve({ filter: /^next\/link$/ }, ({ path }) => ({ path, namespace: "skill-link" }));
      builder.onLoad({ filter: /.*/, namespace: "skill-link" }, () => ({ contents: "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}", resolveDir: root }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const result = module.exports.result;
  assert.match(result.user, /加入技能/); assert.match(result.user, /移除技能/);
  assert.doesNotMatch(result.builtin, /移除技能/); assert.doesNotMatch(result.linked, /移除技能/);
  assert.doesNotMatch(result.remote, /加入技能|移除技能/); assert.match(result.remote, /本机桌面端操作/);
  assert.match(result.import, /选择 SKILL.md/); assert.match(result.import, /选择技能文件夹/); assert.match(result.import, /webkitdirectory/);
  assert.match(result.import, /disabled="">确认加入/);
  assert.match(result.remove, /移除「example」/); assert.match(result.remove, /确认移除/); assert.match(result.remove, /可撤销/);
});
