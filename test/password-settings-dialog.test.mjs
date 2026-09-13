import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { buildSync } from "esbuild";

test("password dialog allows invalid input to be submitted for visible validation", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const compiled = buildSync({
    absWorkingDir: root,
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { PasswordSettingsDialog } from './core/app/src/components/desktop-v627/password-settings-dialog';
      export const html = renderToStaticMarkup(React.createElement(PasswordSettingsDialog, { onClose() {}, onSaved() {} }));
    `, resolveDir: root },
    tsconfig: path.join(root, "core/app/tsconfig.json"),
    platform: "node", format: "cjs", bundle: true, write: false,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { html } = module.exports;
  const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
  assert.ok(submit, "confirmation must submit the form, including Enter-key submission");
  assert.doesNotMatch(submit, /\sdisabled(?:=|\s|>)/, "invalid input must explain the issue rather than leave a dead button");
  assert.match(html, /<form\b[^>]*novalidate/i, "custom validation must run before browser constraint blocking");
  assert.match(html, /<form\b[^>]*method="post"/, "native fallback must never put passwords in a GET query");
  assert.match(html, /name="password"/);
  assert.match(html, /name="confirmation"/);
  assert.match(html, /密码需要 12–256 个字符，两次输入须一致/);
  assert.match(html, /id="password-validation"[^>]*aria-live="polite"/);
  assert.equal((html.match(/autoComplete="new-password"/gi) || []).length, 2);
});
