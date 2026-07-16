use std::{
    env, fs, io,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, OnceLock},
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
const DAEMON_START: &str = "daemon-start";
const DAEMON_STOP: &str = "stop";

static RUNTIME: OnceLock<RuntimeLifecycle> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NavigationDecision {
    AllowInShell,
    OpenInBrowser,
    Deny,
}

pub fn run() {
    let initial_target = target_from_args(std::env::args()).unwrap_or_else(default_target);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
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

            let app_for_navigation = app.handle().clone();
            let navigation = Arc::new(move |url: &Url| {
                if is_close_confirmation(url) {
                    stop_runtime_and_exit(&app_for_navigation);
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
            let nav_for_window = Arc::clone(&navigation);
            let window =
                WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                    .title("Personal Agent")
                    .inner_size(1280.0, 840.0)
                    .min_inner_size(900.0, 620.0)
                    .center()
                    .on_navigation(move |url| nav_for_page(url))
                    .on_new_window(move |url, _features| {
                        nav_for_window(&url);
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

#[derive(Debug)]
struct RuntimeLifecycle {
    install_root: PathBuf,
    data_root: PathBuf,
    node: PathBuf,
    cli: PathBuf,
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
            home_root.join("workspace")
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
        })
    }

    fn start(&self) -> io::Result<()> {
        self.run_action(DAEMON_START)
    }

    fn stop(&self) -> io::Result<()> {
        self.run_action(DAEMON_STOP)
    }

    fn run_action(&self, action: &str) -> io::Result<()> {
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
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_command_window(&mut command);
        let status = command.status()?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "Personal Agent runtime action {action} failed"
            )))
        }
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

fn is_close_confirmation(url: &Url) -> bool {
    is_loopback_console(url)
        && url.path() == CLOSE_PATH
        && url.query().is_none()
        && url.fragment().is_none()
}

fn is_loopback_console(url: &Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some(APP_HOST)
        && url.port_or_known_default() == Some(APP_PORT)
        && url.username().is_empty()
        && url.password().is_none()
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
        let current = Path::new(r"C:\Personal Agent\core\current\desktop\personal-agent-ui.exe");
        assert_eq!(
            infer_install_root_from_executable(current),
            Some(PathBuf::from(r"C:\Personal Agent\core"))
        );
        let release = Path::new(r"C:\Personal Agent\core\releases\v6.27\desktop\personal-agent-ui.exe");
        assert_eq!(
            infer_install_root_from_executable(release),
            Some(PathBuf::from(r"C:\Personal Agent\core"))
        );
    }
}
