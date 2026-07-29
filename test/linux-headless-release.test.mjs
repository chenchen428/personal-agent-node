import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Linux release packaging is headless and uses a systemd user service', () => {
  const workflow = read('.github/workflows/release.yml');
  const builder = read('scripts/build-platform-installer.mjs');
  const service = read('core/runtime/src/platform-service.ts');
  assert.match(workflow, /Assert Linux release stays headless/);
  assert.match(workflow, /if: matrix\.platform != 'linux'/);
  assert.doesNotMatch(workflow, /Install Linux desktop build dependencies/);
  assert.match(builder, /Linux releases must be headless/);
  assert.match(builder, /mode: 'headless'/);
  assert.match(builder, /service: 'systemd-user'/);
  assert.match(builder, /\.tar\.gz/);
  assert.doesNotMatch(builder, /Linux releases[\s\S]*WebKitGTK/);
  assert.match(service, /systemctl --user enable --now private-site-node\.service/);
});

test('version-bound one-line installer verifies the release and never opens a desktop', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-linux-install-'));
  try {
    const tag = 'v1.2.3-beta.4';
    const result = spawnSync(process.execPath, ['scripts/build-linux-install-script.mjs', '--tag', tag, '--output', temporary], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const installer = fs.readFileSync(path.join(temporary, 'personal-agent-node-install.sh'), 'utf8');
    assert.match(installer, /RELEASE_TAG="v1\.2\.3-beta\.4"/);
    assert.match(installer, /uname -m/);
    assert.match(installer, /sha256sum/);
    assert.match(installer, /loginctl enable-linger/);
    assert.match(installer, /"\$setup" install --no-open/);
    assert.match(installer, /ssh -N -L 8843:127\.0\.0\.1:8843/);
    assert.doesNotMatch(installer, /xdg-open|personal-agent-ui|WebKit|Tauri/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
