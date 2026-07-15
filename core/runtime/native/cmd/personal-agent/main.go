package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func main() {
	executable, err := os.Executable()
	if err != nil {
		fail(err)
	}
	installRoot := os.Getenv("PRIVATE_SITE_INSTALL_ROOT")
	if installRoot == "" {
		installRoot = filepath.Dir(filepath.Dir(executable))
	}
	dataRoot := os.Getenv("PRIVATE_SITE_DATA_ROOT")
	if dataRoot == "" {
		homeRoot := os.Getenv("PERSONAL_AGENT_HOME")
		if homeRoot == "" {
			home, _ := os.UserHomeDir()
			homeRoot = filepath.Join(home, ".personal-agent")
		}
		dataRoot = filepath.Join(homeRoot, "workspace")
	}
	current, err := resolveCurrent(filepath.Join(installRoot, "current"))
	if err != nil {
		fail(fmt.Errorf("active Personal Agent release is unavailable: %w", err))
	}
	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	node := filepath.Join(current, "runtime", nodeName)
	entrypoint := filepath.Join(current, "core", "runtime", "bin", "personal-agent.mjs")
	command := exec.Command(node, append([]string{entrypoint}, os.Args[1:]...)...)
	command.Env = append(os.Environ(), "PERSONAL_AGENT_HOME="+filepath.Dir(installRoot), "PRIVATE_SITE_INSTALL_ROOT="+installRoot, "PRIVATE_SITE_DATA_ROOT="+dataRoot)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		fail(err)
	}
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
	target := filepath.Clean(string(data))
	for len(target) > 0 && (target[len(target)-1] == '\n' || target[len(target)-1] == '\r') {
		target = target[:len(target)-1]
	}
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("invalid active release target")
	}
	return target, nil
}

func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
