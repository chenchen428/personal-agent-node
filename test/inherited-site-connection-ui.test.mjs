import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

test("inherited Sites display parent and current domains without owner configuration actions", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const compiled = await build({ absWorkingDir: root, tsconfig: "core/app/tsconfig.json", platform: "node", format: "cjs", bundle: true, write: false,
    stdin: { resolveDir: root, contents: `
      import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {ConnectionActionRow} from './core/app/src/components/desktop-v627/connection-action-row';
      const fixture={id:'sites',description:'当前空间入口验证通过',state:'connected',details:{inherited:true,inheritedFromSpaceId:'parent-private-id',inheritedBaseDomain:'example.test',publicOrigin:'https://space.example.test',relayToken:'never-display-fixture-secret'}};
      const render=connection=>renderToStaticMarkup(React.createElement(ConnectionActionRow,{connection,refresh:async()=>{}}));
      export const result={connected:render(fixture),degraded:render({...fixture,state:'degraded',description:'当前空间入口暂时不可达'}),owner:render({...fixture,details:{...fixture.details,inherited:false}}),mail:render({...fixture,id:'mail'})};
    ` }, plugins: [{ name: "owner-domain-action", setup(builder) {
      builder.onResolve({ filter: /^\.\/domain-binding-action$/ }, ({ path }) => ({ path, namespace: "owner-domain-action" }));
      builder.onLoad({ filter: /.*/, namespace: "owner-domain-action" }, () => ({ contents: "import React from 'react'; export function DomainBindingAction(){return React.createElement('button',null,'owner-domain-configuration')}", resolveDir: root }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  for (const markup of [module.exports.result.connected, module.exports.result.degraded]) {
    assert.match(markup, /继承的域名连接/);
    assert.match(markup, /主空间域名.*example\.test/);
    assert.match(markup, /当前空间入口.*https:\/\/space\.example\.test/);
    assert.match(markup, /请切换到主空间/);
    assert.doesNotMatch(markup, /<button|<a |owner-domain-configuration|清空配置|配置Relay|never-display-fixture-secret|parent-private-id/);
  }
  assert.match(module.exports.result.degraded, /当前空间入口暂时不可达/);
  assert.doesNotMatch(module.exports.result.degraded, /验证通过/);
  assert.match(module.exports.result.owner, /owner-domain-configuration/);
  assert.match(module.exports.result.mail, /owner-domain-configuration/);
});
