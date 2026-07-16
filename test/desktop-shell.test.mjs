import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('desktop application owns the bundled Node backend and constrains its loopback console', () => {
  const rust = read('core/desktop/src-tauri/src/lib.rs');
  const config = JSON.parse(read('core/desktop/src-tauri/tauri.conf.json'));
  const cargo = read('core/desktop/src-tauri/Cargo.toml');
  assert.match(rust, /APP_HOST: &str = "127\.0\.0\.1"/);
  assert.match(rust, /APP_PORT: u16 = 8843/);
  assert.match(rust, /NavigationDecision::OpenInBrowser/);
  assert.match(rust, /NavigationDecision::Deny/);
  assert.match(rust, /struct EmbeddedNodeRuntime/);
  assert.match(rust, /\.command\("start"\)/);
  assert.match(rust, /\.command\("stop"\)/);
  assert.match(rust, /CREATE_NO_WINDOW/);
  assert.match(rust, /RunEvent::Exit/);
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
  assert.match(build, /manifest\.desktopShell/);
  assert.match(build, /writeChecksums\(releaseRoot\)/);
  assert.match(build, /serviceOwner: 'desktop-shell'/);
  assert.match(build, /platform === 'linux' \? 16 : 10/);
  assert.match(build, /compressedBytes: 5 \* 1024 \* 1024/);
  assert.match(installer, /buildGo\('personal-agent'/);
});

test('Windows installation uses a guided wizard and rollback-safe desktop integration', () => {
  const wizard = read('installer/windows/personal-agent.nsi');
  const builder = read('scripts/build-platform-installer.mjs');
  const installer = read('core/runtime/native/internal/install/install.go');
  const launcher = read('core/runtime/native/cmd/personal-agent-ui/main.go');
  const workflow = read('.github/workflows/release.yml');
  for (const requirement of ['MUI_PAGE_WELCOME', 'MUI_PAGE_LICENSE', 'MUI_PAGE_DIRECTORY', 'MUI_PAGE_INSTFILES', 'MUI_PAGE_FINISH', 'Personal Agent 安装向导', 'nsExec::ExecToStack']) {
    assert.match(wizard, new RegExp(requirement));
  }
  assert.match(wizard, /InstallDirRegKey[\s\S]*"InstallLocation"/);
  assert.match(wizard, /install --install-root "\$INSTDIR\\core" --data-root "\$PROFILE\\\.personal-agent\\workspace" --desktop-managed --no-open/);
  assert.match(wizard, /MUI_FINISHPAGE_RUN "\$INSTDIR\\core\\bin\\personal-agent-ui\.exe"/);
  assert.doesNotMatch(wizard, /MUI_FINISHPAGE_RUN[^\n]*personal-agent\.exe/);
  assert.match(wizard, /uninstall --install-root "\$INSTDIR\\core" --confirm-remove-binaries/);
  assert.match(wizard, /已有 Workspace 数据不会被删除/);
  assert.match(wizard, /不会另外安装独立服务/);
  assert.match(wizard, /IfSilent silent_install_error/);
  assert.match(wizard, /IfSilent silent_uninstall_error/);
  assert.match(wizard, /silent_uninstall_error:[\s\S]*SetErrorLevel \$0[\s\S]*Quit/);
  assert.match(builder, /smokeTestWindowsInstaller/);
  assert.match(builder, /'\/INPUTCHARSET',[\s\S]*'UTF8'/);
  assert.match(builder, /PRODUCT_FILE_VERSION=.*windowsProductVersion/);
  assert.match(wizard, /VIProductVersion "\$\{PRODUCT_FILE_VERSION\}"/);
  assert.match(builder, /desktop-entries.*Personal Agent\.lnk/s);
  assert.match(workflow, /choco install nsis --version=3\.12/);
  assert.match(installer, /stopSupervisor/);
  assert.match(installer, /commitDesktopIntegration/);
  assert.ok(installer.indexOf('waitForPort') < installer.indexOf('commitDesktopIntegration(resolved'));
  assert.match(installer, /"Desktop", "Personal Agent\.lnk"/);
  assert.match(installer, /personal-agent\.ico/);
  assert.match(launcher, /请重新运行安装向导进行修复/);
});
