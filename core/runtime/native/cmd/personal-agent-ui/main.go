package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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
	current, err := resolveCurrent(filepath.Join(installRoot, "current"))
	if err != nil {
		fail(fmt.Errorf("active Personal Agent release is unavailable: %w", err))
	}
	runtimePath := desktopRuntime(current, runtime.GOOS)
	if info, statErr := os.Stat(runtimePath); statErr != nil || info.IsDir() {
		fail(fmt.Errorf("Personal Agent desktop runtime is unavailable"))
	}
	command := exec.Command(runtimePath, os.Args[1:]...)
	command.Env = withEnvironment(os.Environ(), map[string]string{
		"PERSONAL_AGENT_HOME":       filepath.Dir(installRoot),
		"PRIVATE_SITE_INSTALL_ROOT": installRoot,
		"PRIVATE_SITE_DATA_ROOT":    filepath.Join(filepath.Dir(installRoot), "workspace"),
	})
	configureDetachedLaunch(command)
	if err := command.Start(); err != nil {
		fail(err)
	}
}

func withEnvironment(base []string, overrides map[string]string) []string {
	result := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key := entry
		if index := strings.IndexByte(entry, '='); index >= 0 {
			key = entry[:index]
		}
		if _, replaced := lookupEnvironmentOverride(overrides, key); !replaced {
			result = append(result, entry)
		}
	}
	for key, value := range overrides {
		result = append(result, key+"="+value)
	}
	return result
}

func lookupEnvironmentOverride(overrides map[string]string, key string) (string, bool) {
	for candidate, value := range overrides {
		if strings.EqualFold(candidate, key) {
			return value, true
		}
	}
	return "", false
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
	_, _ = fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
