import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildNavigationItems, readUpdateStatus, renderNavigationPage, renderUpdatePage } from '../projects/core/admin-panel/page.mjs';

test('workbench exposes only current open-project capabilities', () => {
  const items = buildNavigationItems({ registry: {}, panelConfig: {} });
  const byId = new Map(items.map((item) => [item.id, item]));

  assert.equal(byId.has('files'), false);
  assert.equal(byId.has('releases'), false);
  assert.equal(byId.get('pages')?.href, '/app/pages');
  assert.equal(byId.get('pages')?.label, 'Online Pages');
  assert.equal(byId.get('skills')?.href, '/app/skills');
  assert.equal(byId.get('skills')?.label, '技能列表');
  assert.equal(byId.get('update')?.href, '/app/update');

  const routes = JSON.parse(fs.readFileSync(new URL('../registry/routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    routes.routes.find((route) => route.pattern === '/app/pages'),
    { pattern: '/app/pages', access: 'authenticated', capability: 'publications' },
  );
  assert.deepEqual(
    routes.routes.find((route) => route.pattern === '/app/skills'),
    { pattern: '/app/skills', access: 'authenticated', capability: 'skills' },
  );
  assert.deepEqual(
    routes.routes.find((route) => route.pattern === '/app/update'),
    { pattern: '/app/update', access: 'local-admin', capability: 'runtime' },
  );
});

test('workbench branding is project-neutral', () => {
  const html = renderNavigationPage({
    title: 'Personal Agent',
    items: buildNavigationItems({ registry: {}, panelConfig: {} }),
  });

  assert.doesNotMatch(html, /brand-stamp/);
  assert.doesNotMatch(html, />陈</);
  assert.doesNotMatch(html, /data-nav-id="(?:files|releases)"/);
  assert.match(html, /href="\/app\/pages"[^>]*data-nav-id="pages"/);
  assert.match(html, /href="\/app\/skills"[^>]*data-nav-id="skills"/);
  assert.match(html, /href="\/app\/update"[^>]*data-nav-id="update"/);
});

test('update page reports immutable release status without exposing an apply action', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-admin-panel-release-'));
  try {
    fs.writeFileSync(path.join(fixtureRoot, 'release-manifest.json'), JSON.stringify({ releaseType: 'private-site-node', releaseId: '1.2.3', revision: 'a'.repeat(40), profile: 'universal' }));
    fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    fs.mkdirSync(path.join(fixtureRoot, 'registry'));
    fs.writeFileSync(path.join(fixtureRoot, 'registry', 'commands.json'), JSON.stringify({ commands: [{ name: 'update check|plan|apply|rollback', implementationStatus: 'planned' }] }));
    const status = readUpdateStatus({ releaseRoot: fixtureRoot, installRoot: fixtureRoot });
    const html = renderUpdatePage({ title: 'Personal Agent', status });
    assert.equal(status.currentReleaseId, '1.2.3');
    assert.equal(status.commandStatus, 'planned');
    assert.match(html, /更新与回滚/);
    assert.match(html, /统一的一键更新仍未开放/);
    assert.match(html, /查看 GitHub Releases/);
    assert.doesNotMatch(html, /data-update-apply|执行更新|立即回滚/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
