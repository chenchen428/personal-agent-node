package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/chenchen428/personal-agent-node/native/internal/runtimeconfig"
)

var buildVersion = "development"

func main() {
	executable, err := os.Executable()
	if err != nil {
		fail(err)
	}
	installRoot := os.Getenv("PRIVATE_SITE_INSTALL_ROOT")
	if installRoot == "" {
		installRoot = filepath.Dir(filepath.Dir(executable))
	}
	roots, err := runtimeconfig.ResolveRoots(installRoot)
	if err != nil {
		fail(err)
	}
	current, err := resolveCurrent(filepath.Join(installRoot, "current"))
	if err != nil {
		fail(fmt.Errorf("active Personal Agent release is unavailable: %w", err))
	}
	runtimePath := desktopRuntime(current, runtime.GOOS)
	if info, statErr := os.Stat(runtimePath); statErr != nil || info.IsDir() {
		fail(fmt.Errorf("Personal Agent desktop runtime is unavailable"))
	}
	command := exec.Command(runtimePath, os.Args[1:]...)
	command.Env = append(os.Environ(), "PERSONAL_AGENT_HOME="+roots.HomeRoot, "PRIVATE_SITE_INSTALL_ROOT="+installRoot, "PRIVATE_SITE_DATA_ROOT="+roots.DataRoot, "PRIVATE_SITE_RELEASE_ROOT="+current)
	if err := command.Start(); err != nil {
		fail(err)
	}
}

func desktopRuntime(releaseRoot, platform string) string {
	if platform == "windows" {
		return filepath.Join(releaseRoot, "desktop", "personal-agent-ui.exe")
	}
	if platform == "darwin" {
		return filepath.Join(releaseRoot, "desktop", "Personal Agent.app", "Contents", "MacOS", "personal-agent-ui")
	}
	return filepath.Join(releaseRoot, "desktop", "personal-agent-ui")
}

func resolveCurrent(pointer string) (string, error) {
	if target, err := filepath.EvalSymlinks(pointer); err == nil {
		if info, statErr := os.Stat(target); statErr == nil && info.IsDir() {
			return target, nil
		}
	}
	data, err := os.ReadFile(pointer)
	if err != nil || len(data) > 4096 {
		return "", fmt.Errorf("invalid active release pointer")
	}
	target := filepath.Clean(strings.TrimSpace(string(data)))
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("invalid active release target")
	}
	return target, nil
}

func fail(err error) {
	message := fmt.Sprintf("Personal Agent 无法启动。\n\n%v\n\n请重新运行安装向导进行修复；你的 Workspace 数据会保留。", err)
	showError(message)
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
