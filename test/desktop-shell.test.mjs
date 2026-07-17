import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('desktop shell is a constrained view over the existing loopback console', () => {
  const rust = read('core/desktop/src-tauri/src/lib.rs');
  const config = JSON.parse(read('core/desktop/src-tauri/tauri.conf.json'));
  const cargo = read('core/desktop/src-tauri/Cargo.toml');
  assert.match(rust, /APP_HOST: &str = "127\.0\.0\.1"/);
  assert.match(rust, /APP_PORT: u16 = 8843/);
  assert.match(rust, /DEFAULT_APP_URL: &str = "http:\/\/127\.0\.0\.1:8843\/app"/);
  assert.match(rust, /infer_install_root_from_executable/);
  assert.match(rust, /window\.location\.href='http:\/\/127\.0\.0\.1:8843\/__personal-agent\/close'/);
  assert.match(rust, /NavigationDecision::OpenInBrowser/);
  assert.match(rust, /NavigationDecision::Deny/);
  assert.doesNotMatch(rust, /invoke_handler|#\[tauri::command\]/);
  assert.equal(config.app.withGlobalTauri, false);
  assert.deepEqual(config.app.windows, []);
  assert.match(config.app.security.csp, /connect-src 'none'/);
  assert.match(cargo, /tauri-plugin-single-instance/);
  assert.doesNotMatch(cargo, /tauri-plugin-shell|tauri-plugin-fs/);
});

test('desktop shell stays inside the immutable platform release', () => {
  const build = read('scripts/build-desktop-shell.mjs');
  const installer = read('scripts/build-platform-installer.mjs');
  const releaseWorkflow = read('.github/workflows/release.yml');
  assert.match(build, /manifest\.desktopShell/);
  assert.match(build, /writeChecksums\(releaseRoot\)/);
  assert.match(installer, /buildGo\('personal-agent'/);
  assert.doesNotMatch(installer, /buildGo\('personal-agent-service'/);
  assert.match(installer, /Windows Xiaohongshu runtime is missing/);
  assert.match(installer, /core\/channels\/xiaohongshu\/runtime\/xiaohongshu-mcp\.exe/);
  assert.match(releaseWorkflow, /Build pinned Xiaohongshu runtime for Windows/);
  assert.match(releaseWorkflow, /--local-xiaohongshu --output-root dist\/release-payload\/core\/channels\/xiaohongshu\/runtime/);
  const rust = read('core/desktop/src-tauri/src/lib.rs');
  assert.match(rust, /DAEMON_START: &str = "daemon-start"/);
  assert.match(rust, /DAEMON_STOP: &str = "stop"/);
  assert.match(rust, /RunEvent::Exit/);
  assert.match(rust, /WindowEvent::CloseRequested/);
  assert.match(rust, /__personal-agent\/close/);
  assert.match(rust, /creation_flags\(0x08000000\)/);
});
