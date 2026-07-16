use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Arc,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{
    webview::{NewWindowResponse, WebviewWindowBuilder},
    Manager, Url, WebviewUrl,
};

const APP_HOST: &str = "127.0.0.1";
const APP_PORT: u16 = 8843;
const DEFAULT_APP_URL: &str = "http://127.0.0.1:8843/app";
const MAIN_WINDOW: &str = "main";

#[derive(Debug)]
struct EmbeddedNodeRuntime {
    install_root: PathBuf,
    release_root: PathBuf,
    data_root: PathBuf,
    home_root: PathBuf,
    node: PathBuf,
    entrypoint: PathBuf,
    child: Mutex<Option<Child>>,
}

impl EmbeddedNodeRuntime {
    fn from_environment() -> Result<Self, String> {
        let install_root = required_absolute_directory("PRIVATE_SITE_INSTALL_ROOT")?;
        let release_root = required_absolute_directory("PRIVATE_SITE_RELEASE_ROOT")?;
        let data_root = required_absolute_path("PRIVATE_SITE_DATA_ROOT")?;
        let home_root = required_absolute_path("PERSONAL_AGENT_HOME")?;
        let node =
            release_root
                .join("runtime")
                .join(if cfg!(windows) { "node.exe" } else { "node" });
        let entrypoint = release_root
            .join("core")
            .join("runtime")
            .join("bin")
            .join("private-site.mjs");
        if !node.is_file() {
            return Err("内置 Node.js 运行时不存在，请重新安装 Personal Agent。".into());
        }
        if !entrypoint.is_file() {
            return Err("内置后台入口不存在，请重新安装 Personal Agent。".into());
        }
        Ok(Self {
            install_root,
            release_root,
            data_root,
            home_root,
            node,
            entrypoint,
            child: Mutex::new(None),
        })
    }

    fn start(&self) -> Result<(), String> {
        self.stop();
        let child = self
            .command("start")
            .spawn()
            .map_err(|error| format!("无法启动内置后台服务：{error}"))?;
        *self.child.lock().map_err(|_| "后台进程状态不可用")? = Some(child);
        Ok(())
    }

    fn stop(&self) {
        let _ = self.command("stop").status();
        let Ok(mut slot) = self.child.lock() else {
            return;
        };
        if let Some(mut child) = slot.take() {
            let deadline = Instant::now() + Duration::from_secs(5);
            while child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(100));
            }
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        while gateway_ready() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn command(&self, action: &str) -> Command {
        let mut command = Command::new(&self.node);
        command
            .arg(&self.entrypoint)
            .arg(action)
            .arg("--data-root")
            .arg(&self.data_root)
            .env("PERSONAL_AGENT_HOME", &self.home_root)
            .env("PRIVATE_SITE_INSTALL_ROOT", &self.install_root)
            .env("PRIVATE_SITE_RELEASE_ROOT", &self.release_root)
            .env("PRIVATE_SITE_DATA_ROOT", &self.data_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console_window(&mut command);
        command
    }
}

fn required_absolute_directory(name: &str) -> Result<PathBuf, String> {
    let path = required_absolute_path(name)?;
    if !path.is_dir() {
        return Err(format!("{name} 目录不存在，请重新安装 Personal Agent。"));
    }
    Ok(path)
}

fn required_absolute_path(name: &str) -> Result<PathBuf, String> {
    let value = std::env::var_os(name)
        .ok_or_else(|| format!("缺少 {name}，请从已安装的 Personal Agent 快捷方式启动。"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("{name} 必须是绝对路径。"));
    }
    Ok(path)
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NavigationDecision {
    AllowInShell,
    OpenInBrowser,
    Deny,
}

pub fn run() {
    let initial_target = target_from_args(std::env::args()).unwrap_or_else(default_target);
    let embedded_runtime = Arc::new(
        EmbeddedNodeRuntime::from_environment().unwrap_or_else(|error| {
            panic!("Personal Agent embedded runtime is unavailable: {error}")
        }),
    );
    let runtime_for_setup = Arc::clone(&embedded_runtime);

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
            let navigation = Arc::new(|url: &Url| match navigation_decision(url) {
                NavigationDecision::AllowInShell => true,
                NavigationDecision::OpenInBrowser => {
                    let _ = opener::open_browser(url.as_str());
                    false
                }
                NavigationDecision::Deny => false,
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

            if let Err(error) = runtime_for_setup.start() {
                set_status(&window, "内置后台无法启动", &error);
                return Ok(());
            }
            wait_for_gateway(window, initial_target);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Personal Agent desktop application failed to build");
    app.run(move |_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            embedded_runtime.stop();
        }
    });
}

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
}
