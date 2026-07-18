use std::{
    env, fs, io,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    webview::{NewWindowResponse, WebviewWindowBuilder},
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WindowEvent,
};

const APP_HOST: &str = "127.0.0.1";
const APP_PORT: u16 = 8843;
const DEFAULT_APP_URL: &str = "http://127.0.0.1:8843/app";
const MAIN_WINDOW: &str = "main";
const CLOSE_PATH: &str = "/__personal-agent/close";
const REVEAL_EXPORT_PATH: &str = "/__personal-agent/reveal-export";
const DAEMON_START: &str = "daemon-start";
const DAEMON_STOP: &str = "stop";
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(2);
const WATCHDOG_FAILURE_THRESHOLD: u8 = 3;

static RUNTIME: OnceLock<RuntimeLifecycle> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NavigationDecision {
    AllowInShell,
    OpenInBrowser,
    Deny,
}

pub fn run() {
    let arguments: Vec<String> = std::env::args().collect();
    let initial_target = target_from_args(&arguments).unwrap_or_else(default_target);
    let initial_handoff = update_handoff_from_args(&arguments);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some((job_id, nonce)) = update_handoff_from_args(&args) {
                let _ = accept_update_handoff(app, &job_id, &nonce);
                return;
            }
            let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
                return;
            };
            if let Some(target) = target_from_args(args) {
                if gateway_ready() {
                    let _ = window.navigate(target);
                }
            }
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }))
        .setup(move |app| {
            let runtime = RuntimeLifecycle::from_environment()?;
            runtime.start()?;
            RUNTIME.set(runtime).map_err(|_| {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "runtime lifecycle is already initialized",
                )
            })?;
            start_runtime_watchdog();

            if let Some((job_id, nonce)) = initial_handoff.as_ref() {
                accept_update_handoff(app.handle(), job_id, nonce)?;
                return Ok(());
            }

            let app_for_navigation = app.handle().clone();
            let navigation = Arc::new(move |url: &Url| {
                if is_close_confirmation(url) {
                    stop_runtime_and_exit(&app_for_navigation);
                    return false;
                }
                if is_reveal_export_request(url) {
                    if let Some(target) = RUNTIME
                        .get()
                        .and_then(|runtime| resolve_export_to_reveal(url, &runtime.data_root))
                    {
                        let _ = opener::reveal(target);
                    }
                    return false;
                }
                match navigation_decision(url) {
                    NavigationDecision::AllowInShell => true,
                    NavigationDecision::OpenInBrowser => {
                        let _ = opener::open_browser(url.as_str());
                        false
                    }
                    NavigationDecision::Deny => false,
                }
            });
            let nav_for_page = Arc::clone(&navigation);
            let window =
                WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                    .title("Personal Agent")
                    .inner_size(1280.0, 840.0)
                    .min_inner_size(900.0, 620.0)
                    .center()
                    .on_navigation(move |url| nav_for_page(url))
                    .on_new_window(move |url, _features| {
                        if new_window_decision(&url) == NavigationDecision::OpenInBrowser {
                            let _ = opener::open_browser(url.as_str());
                        }
                        NewWindowResponse::Deny
                    })
                    .build()?;

            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_window.eval(
                        "window.dispatchEvent(new Event('personal-agent-close-requested'));if(window.__personalAgentCloseHandlerReady!==true){window.location.href='http://127.0.0.1:8843/__personal-agent/close';}",
                    );
                }
            });
            wait_for_gateway(window, initial_target);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Personal Agent desktop shell failed to initialize");

    app.run(|_, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(runtime) = RUNTIME.get() {
                let _ = runtime.stop();
            }
        }
    });
}

fn stop_runtime_and_exit(app: &AppHandle) {
    if let Some(runtime) = RUNTIME.get() {
        let _ = runtime.stop();
    }
    app.exit(0);
}

fn start_runtime_watchdog() {
    thread::spawn(|| {
        let mut consecutive_failures = 0_u8;
        loop {
            thread::sleep(WATCHDOG_INTERVAL);
            let Some(runtime) = RUNTIME.get() else {
                continue;
            };
            if runtime.stopping.load(Ordering::SeqCst) {
                return;
            }
            if gateway_ready() {
                consecutive_failures = 0;
                continue;
            }
            consecutive_failures = consecutive_failures.saturating_add(1);
            if consecutive_failures < WATCHDOG_FAILURE_THRESHOLD {
                continue;
            }
            let _ = runtime.start();
            consecutive_failures = 0;
        }
    });
}

fn update_handoff_from_args<I, S>(args: I) -> Option<(String, String)>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let values: Vec<String> = args
        .into_iter()
        .map(|value| value.as_ref().to_owned())
        .collect();
    let job_id = values
        .windows(2)
        .find(|pair| pair[0] == "--apply-update")
        .map(|pair| pair[1].clone())?;
    let nonce = values
        .windows(2)
        .find(|pair| pair[0] == "--nonce")
        .map(|pair| pair[1].clone())?;
    if !job_id.starts_with("update_")
        || !job_id[7..]
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
        || nonce.len() < 32
        || !nonce
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
    {
        return None;
    }
    Some((job_id, nonce))
}

fn accept_update_handoff(app: &AppHandle, job_id: &str, nonce: &str) -> io::Result<()> {
    let runtime = RUNTIME.get().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "runtime lifecycle is unavailable")
    })?;
    let job_dir = runtime
        .data_root
        .join("installation")
        .join("updates")
        .join(job_id);
    let job_file = job_dir.join("job.json");
    let mut job: serde_json::Value = serde_json::from_slice(&fs::read(&job_file)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if job.get("id").and_then(|value| value.as_str()) != Some(job_id)
        || job.get("status").and_then(|value| value.as_str()) != Some("handoff")
        || job.get("handoffNonce").and_then(|value| value.as_str()) != Some(nonce)
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "update handoff is not approved",
        ));
    }
    let kind = job
        .get("kind")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_owned();
    let executable = if kind == "apply" {
        let candidate = PathBuf::from(
            job.get("artifactPath")
                .and_then(|value| value.as_str())
                .ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "update candidate is missing")
                })?,
        );
        let canonical_candidate = fs::canonicalize(candidate)?;
        let canonical_job_dir = fs::canonicalize(&job_dir)?;
        if canonical_candidate.parent() != Some(canonical_job_dir.as_path())
            || !canonical_candidate.is_file()
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "update candidate is outside the approved job",
            ));
        }
        canonical_candidate
    } else if kind == "rollback" {
        runtime.install_root.join("bin").join(if cfg!(windows) {
            "personal-agent-setup.exe"
        } else {
            "personal-agent-setup"
        })
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unknown update handoff kind",
        ));
    };
    job["status"] = serde_json::Value::String("activating".into());
    let temporary = job_file.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&job).map_err(io::Error::other)?,
    )?;
    fs::rename(temporary, &job_file)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&job_file, fs::Permissions::from_mode(0o600))?;
    }
    runtime.stop()?;
    let mut command = Command::new(executable);
    command
        .arg(if kind == "apply" {
            "update"
        } else {
            "rollback-update"
        })
        .arg("--home")
        .arg(
            runtime
                .install_root
                .parent()
                .unwrap_or(&runtime.install_root),
        )
        .arg("--job")
        .arg(&job_file)
        .arg("--nonce")
        .arg(nonce)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_command_window(&mut command);
    command.spawn()?;
    app.exit(0);
    Ok(())
}

#[derive(Debug)]
struct RuntimeLifecycle {
    install_root: PathBuf,
    data_root: PathBuf,
    node: PathBuf,
    cli: PathBuf,
    supervisor_pid: AtomicU32,
    stopping: AtomicBool,
}

impl RuntimeLifecycle {
    fn from_environment() -> io::Result<Self> {
        let inferred_install_root = infer_install_root();
        let installed_runtime = inferred_install_root.is_some();
        let install_root = inferred_install_root
            .or_else(|| env::var_os("PRIVATE_SITE_INSTALL_ROOT").map(PathBuf::from))
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Personal Agent install root is unavailable",
                )
            })?;
        let current = resolve_current(&install_root.join("current"))?;
        let home_root = if installed_runtime {
            install_root.parent().map(Path::to_path_buf)
        } else {
            env::var_os("PERSONAL_AGENT_HOME")
                .map(PathBuf::from)
                .or_else(|| install_root.parent().map(Path::to_path_buf))
        }
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "Personal Agent home is unavailable",
            )
        })?;
        let data_root = if installed_runtime {
            installed_data_root(&install_root).unwrap_or_else(|| home_root.join("workspace"))
        } else {
            env::var_os("PRIVATE_SITE_DATA_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| home_root.join("workspace"))
        };
        let node = current
            .join("runtime")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let cli = current.join("core/runtime/bin/private-site.mjs");
        if !node.is_file() || !cli.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Personal Agent bundled runtime is incomplete",
            ));
        }
        Ok(Self {
            install_root,
            data_root,
            node,
            cli,
            supervisor_pid: AtomicU32::new(0),
            stopping: AtomicBool::new(false),
        })
    }

    fn start(&self) -> io::Result<()> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "runtime lifecycle is stopping",
            ));
        }
        let result = self.run_action(DAEMON_START, &[])?;
        let pid = result
            .get("pid")
            .and_then(|value| value.as_u64())
            .and_then(|value| u32::try_from(value).ok())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "runtime start did not return a supervisor PID",
                )
            })?;
        self.supervisor_pid.store(pid, Ordering::SeqCst);
        if self.stopping.load(Ordering::SeqCst) {
            let _ = self.run_action(DAEMON_STOP, &["--expected-pid", &pid.to_string()]);
            self.supervisor_pid.store(0, Ordering::SeqCst);
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "runtime lifecycle stopped during startup",
            ));
        }
        Ok(())
    }

    fn stop(&self) -> io::Result<()> {
        self.stopping.store(true, Ordering::SeqCst);
        let pid = self.supervisor_pid.swap(0, Ordering::SeqCst);
        if pid == 0 {
            return Ok(());
        }
        self.run_action(DAEMON_STOP, &["--expected-pid", &pid.to_string()])?;
        Ok(())
    }

    fn run_action(&self, action: &str, extra_args: &[&str]) -> io::Result<serde_json::Value> {
        let mut command = Command::new(&self.node);
        command
            .arg(&self.cli)
            .arg(action)
            .arg("--data-root")
            .arg(&self.data_root)
            .env(
                "PERSONAL_AGENT_HOME",
                self.install_root.parent().unwrap_or(&self.install_root),
            )
            .env("PRIVATE_SITE_INSTALL_ROOT", &self.install_root)
            .env("PRIVATE_SITE_DATA_ROOT", &self.data_root)
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        command.args(extra_args);
        hide_command_window(&mut command);
        let output = command.output()?;
        if !output.status.success() {
            return Err(io::Error::other(format!(
                "Personal Agent runtime action {action} failed"
            )));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
}

fn infer_install_root() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    infer_install_root_from_executable(&executable)
}

fn infer_install_root_from_executable(executable: &Path) -> Option<PathBuf> {
    executable.ancestors().find_map(|ancestor| {
        let name = ancestor.file_name()?.to_string_lossy();
        if name.eq_ignore_ascii_case("current") || name.eq_ignore_ascii_case("releases") {
            ancestor.parent().map(Path::to_path_buf)
        } else {
            None
        }
    })
}

fn installed_data_root(install_root: &Path) -> Option<PathBuf> {
    let document: serde_json::Value =
        serde_json::from_slice(&fs::read(install_root.join("installation.json")).ok()?).ok()?;
    let value = PathBuf::from(document.get("dataRoot")?.as_str()?);
    value.is_absolute().then_some(value)
}

fn resolve_current(pointer: &Path) -> io::Result<PathBuf> {
    if pointer.is_dir() {
        return Ok(pointer.to_path_buf());
    }
    let target = PathBuf::from(fs::read_to_string(pointer)?.trim());
    if target.is_dir() {
        Ok(target)
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Personal Agent current release pointer is invalid",
        ))
    }
}

#[cfg(windows)]
fn hide_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_command_window(_command: &mut Command) {}

fn wait_for_gateway(window: tauri::WebviewWindow, target: Url) {
    thread::spawn(move || {
        let started = Instant::now();
        let mut reported_slow = false;
        let mut reported_recovery = false;
        loop {
            if gateway_ready() {
                let _ = window.navigate(target.clone());
                return;
            }
            if !reported_slow && started.elapsed() >= Duration::from_secs(15) {
                reported_slow = true;
                set_status(
                    &window,
                    "后台服务仍在启动，请稍候…",
                    "首次启动或升级后可能需要更长时间。",
                );
            }
            if !reported_recovery && started.elapsed() >= Duration::from_secs(90) {
                reported_recovery = true;
                set_status(
                    &window,
                    "暂时无法连接本机服务",
                    "请运行 personal-agent doctor；此窗口会继续自动重试。",
                );
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}

fn set_status(window: &tauri::WebviewWindow, status: &str, detail: &str) {
    let status = js_string(status);
    let detail = js_string(detail);
    let script = format!(
        "if(location.protocol==='tauri:'||location.host==='tauri.localhost'){{document.getElementById('status').textContent={status};document.getElementById('detail').textContent={detail};}}"
    );
    let _ = window.eval(script);
}

fn js_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('\"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

fn gateway_ready() -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), APP_PORT);
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn default_target() -> Url {
    DEFAULT_APP_URL
        .parse()
        .expect("default app URL must be valid")
}

fn target_from_args<I, S>(args: I) -> Option<Url>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let values: Vec<String> = args
        .into_iter()
        .map(|value| value.as_ref().to_owned())
        .collect();
    values
        .windows(2)
        .find(|pair| pair[0] == "--url")
        .and_then(|pair| pair[1].parse::<Url>().ok())
        .filter(is_loopback_console)
}

fn navigation_decision(url: &Url) -> NavigationDecision {
    if is_loopback_console(url) || is_shell_asset(url) || url.scheme() == "about" {
        NavigationDecision::AllowInShell
    } else if matches!(url.scheme(), "http" | "https") {
        NavigationDecision::OpenInBrowser
    } else {
        NavigationDecision::Deny
    }
}

fn new_window_decision(url: &Url) -> NavigationDecision {
    if is_close_confirmation(url) || is_reveal_export_request(url) {
        return NavigationDecision::Deny;
    }
    match navigation_decision(url) {
        NavigationDecision::AllowInShell | NavigationDecision::OpenInBrowser => {
            NavigationDecision::OpenInBrowser
        }
        NavigationDecision::Deny => NavigationDecision::Deny,
    }
}

fn is_close_confirmation(url: &Url) -> bool {
    is_loopback_console(url)
        && url.path() == CLOSE_PATH
        && url.query().is_none()
        && url.fragment().is_none()
}

fn is_reveal_export_request(url: &Url) -> bool {
    is_loopback_console(url) && url.path() == REVEAL_EXPORT_PATH && url.fragment().is_none()
}

fn resolve_export_to_reveal(url: &Url, data_root: &Path) -> Option<PathBuf> {
    if !is_reveal_export_request(url) {
        return None;
    }
    let id = url
        .query_pairs()
        .find(|(key, _)| key == "id")
        .map(|(_, value)| value.into_owned())?;
    if !id.starts_with("export-")
        || !id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
    {
        return None;
    }
    let space_root = space_root_for_port(data_root, url.port_or_known_default()?)?;
    let export_root = fs::canonicalize(space_root.join("exports")).ok()?;
    let candidate = fs::canonicalize(export_root.join(format!("{id}.zip"))).ok()?;
    (candidate.is_file() && candidate.parent() == Some(export_root.as_path())).then_some(candidate)
}

fn space_root_for_port(data_root: &Path, gateway_port: u16) -> Option<PathBuf> {
    let spaces_root = fs::canonicalize(data_root.join("spaces")).ok()?;
    for entry in fs::read_dir(&spaces_root).ok()?.flatten() {
        let metadata = entry.metadata().ok()?;
        if !metadata.is_dir() || entry.file_type().ok()?.is_symlink() {
            continue;
        }
        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(entry.path().join("space.json")).ok()?).ok()?;
        let port = document
            .get("allocatedPorts")
            .and_then(|ports| ports.get("gateway"))
            .and_then(|value| value.as_u64());
        if port == Some(u64::from(gateway_port)) {
            let candidate = fs::canonicalize(entry.path()).ok()?;
            if candidate.parent() == Some(spaces_root.as_path()) {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_loopback_console(url: &Url) -> bool {
    let port = url.port_or_known_default();
    url.scheme() == "http"
        && url.host_str() == Some(APP_HOST)
        && port.is_some_and(is_space_gateway_port)
        && url.username().is_empty()
        && url.password().is_none()
}

fn is_space_gateway_port(port: u16) -> bool {
    port >= APP_PORT && port <= APP_PORT + 500 * 20 && (port - APP_PORT) % 20 == 0
}

fn is_shell_asset(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_exact_loopback_console_origin() {
        for value in [
            "http://127.0.0.1:8843/",
            "http://127.0.0.1:8863/app",
            "http://127.0.0.1:8843/app",
            "http://127.0.0.1:8843/app/setup/bootstrap?token=redacted",
        ] {
            assert!(is_loopback_console(&value.parse().unwrap()));
        }
        for value in [
            "http://localhost:8843/app",
            "http://127.0.0.1:8844/app",
            "https://127.0.0.1:8843/app",
            "http://user@127.0.0.1:8843/app",
            "http://127.0.0.2:8843/app",
        ] {
            assert!(!is_loopback_console(&value.parse().unwrap()), "{value}");
        }
    }

    #[test]
    fn installer_target_is_allowlisted_and_never_inferred_from_other_arguments() {
        let accepted = target_from_args([
            "personal-agent-ui",
            "--url",
            "http://127.0.0.1:8843/app/setup/bootstrap?token=redacted",
        ]);
        assert_eq!(accepted.unwrap().path(), "/app/setup/bootstrap");
        assert!(target_from_args(["personal-agent-ui", "--url", "https://example.com/"]).is_none());
        assert!(target_from_args(["personal-agent-ui", "http://127.0.0.1:8843/app"]).is_none());
    }

    #[test]
    fn update_handoff_requires_a_scoped_job_and_strong_nonce() {
        let handoff = update_handoff_from_args([
            "personal-agent-ui",
            "--apply-update",
            "update_1234-abcd",
            "--nonce",
            "abcdefghijklmnopqrstuvwxyz0123456789-_",
        ]);
        assert_eq!(handoff.unwrap().0, "update_1234-abcd");
        assert!(update_handoff_from_args([
            "personal-agent-ui",
            "--apply-update",
            "../job",
            "--nonce",
            "abcdefghijklmnopqrstuvwxyz0123456789-_",
        ])
        .is_none());
        assert!(update_handoff_from_args([
            "personal-agent-ui",
            "--apply-update",
            "update_1234",
            "--nonce",
            "short",
        ])
        .is_none());
    }

    #[test]
    fn navigation_keeps_local_pages_inside_and_external_web_pages_outside() {
        assert_eq!(
            navigation_decision(&"http://127.0.0.1:8843/app/chat".parse().unwrap()),
            NavigationDecision::AllowInShell
        );
        assert_eq!(
            navigation_decision(&"https://github.com/login/oauth/authorize".parse().unwrap()),
            NavigationDecision::OpenInBrowser
        );
        assert_eq!(
            navigation_decision(&"file:///etc/passwd".parse().unwrap()),
            NavigationDecision::Deny
        );
    }

    #[test]
    fn new_windows_open_safe_local_and_external_pages_in_the_system_browser() {
        for value in [
            "http://127.0.0.1:8843/public/uploads/demo/index.html",
            "http://127.0.0.1:8843/publications/private/index.html",
            "https://github.com/login/oauth/authorize",
        ] {
            assert_eq!(
                new_window_decision(&value.parse().unwrap()),
                NavigationDecision::OpenInBrowser,
                "{value}"
            );
        }
        for value in [
            "file:///etc/passwd",
            "http://127.0.0.1:8843/__personal-agent/close",
            "http://127.0.0.1:8843/__personal-agent/reveal-export?id=export-123",
        ] {
            assert_eq!(
                new_window_decision(&value.parse().unwrap()),
                NavigationDecision::Deny,
                "{value}"
            );
        }
    }

    #[test]
    fn export_reveal_accepts_only_a_completed_export_inside_the_data_root() {
        let root = env::temp_dir().join(format!("pa-reveal-export-{}", std::process::id()));
        let space = root.join("spaces").join("sp_personal");
        let exports = space.join("exports");
        fs::create_dir_all(&exports).unwrap();
        fs::write(
            space.join("space.json"),
            br#"{"schemaVersion":1,"spaceId":"sp_personal","allocatedPorts":{"gateway":8843}}"#,
        )
        .unwrap();
        let target = exports.join("export-123-abcdef.zip");
        fs::write(&target, b"zip").unwrap();
        let url: Url = "http://127.0.0.1:8843/__personal-agent/reveal-export?id=export-123-abcdef"
            .parse()
            .unwrap();
        assert_eq!(
            resolve_export_to_reveal(&url, &root),
            Some(fs::canonicalize(&target).unwrap())
        );
        let traversal: Url = "http://127.0.0.1:8843/__personal-agent/reveal-export?id=..%2Fsecret"
            .parse()
            .unwrap();
        assert!(resolve_export_to_reveal(&traversal, &root).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn desktop_shell_owns_the_runtime_start_and_stop_actions() {
        assert_eq!(DAEMON_START, "daemon-start");
        assert_eq!(DAEMON_STOP, "stop");
        assert!(is_close_confirmation(
            &"http://127.0.0.1:8843/__personal-agent/close"
                .parse()
                .unwrap()
        ));
        assert!(!is_close_confirmation(
            &"https://example.com/__personal-agent/close"
                .parse()
                .unwrap()
        ));
    }

    #[test]
    fn installed_shell_infers_root_from_current_or_release_layout() {
        let (current, release, expected) = if cfg!(windows) {
            (
                Path::new(r"C:\Personal Agent\core\current\desktop\personal-agent-ui.exe"),
                Path::new(r"C:\Personal Agent\core\releases\v6.27\desktop\personal-agent-ui.exe"),
                PathBuf::from(r"C:\Personal Agent\core"),
            )
        } else {
            (
                Path::new("/opt/personal-agent/core/current/desktop/personal-agent-ui"),
                Path::new("/opt/personal-agent/core/releases/v6.27/desktop/personal-agent-ui"),
                PathBuf::from("/opt/personal-agent/core"),
            )
        };
        assert_eq!(
            infer_install_root_from_executable(current),
            Some(expected.clone())
        );
        assert_eq!(infer_install_root_from_executable(release), Some(expected));
    }
}
