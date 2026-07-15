package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveCurrentSupportsWindowsPointerFile(t *testing.T) {
	root := t.TempDir()
	release := filepath.Join(root, "releases", "0.0.1")
	if err := os.MkdirAll(release, 0o700); err != nil {
		t.Fatal(err)
	}
	pointer := filepath.Join(root, "current")
	if err := os.WriteFile(pointer, []byte(release+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveCurrent(pointer)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != release {
		t.Fatalf("resolved %q, want %q", resolved, release)
	}
}

func TestDesktopRuntimeIsPlatformSpecific(t *testing.T) {
	root := filepath.Join("release")
	for platform, expected := range map[string]string{
		"windows": filepath.Join(root, "desktop", "personal-agent-ui.exe"),
		"linux":   filepath.Join(root, "desktop", "personal-agent-ui"),
		"darwin":  filepath.Join(root, "desktop", "Personal Agent.app", "Contents", "MacOS", "personal-agent-ui"),
	} {
		if actual := desktopRuntime(root, platform); actual != expected {
			t.Fatalf("%s runtime %q, want %q", platform, actual, expected)
		}
	}
}
