package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestWaitForDesktopParentExit(t *testing.T) {
	calls := 0
	if err := waitForDesktopParentExit(42, func() int {
		calls++
		if calls == 1 {
			return 42
		}
		return 1
	}, time.Second); err != nil {
		t.Fatal(err)
	}
	if calls < 2 {
		t.Fatal("previous desktop was not observed exiting")
	}
	if err := waitForDesktopParentExit(42, func() int { return 42 }, 0); err == nil {
		t.Fatal("a desktop that never exits must fail the update")
	}
}

func TestMacRollbackLaunchesCurrentDesktopExecutable(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS desktop bundle test")
	}
	home := t.TempDir()
	executable := filepath.Join(home, "core", "current", "desktop", "Personal Agent.app", "Contents", "MacOS", "personal-agent-ui")
	if err := os.MkdirAll(filepath.Dir(executable), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nprintf '%s' \"$2\" > \"$PERSONAL_AGENT_HOME/desktop-launched\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := launchInstalledDesktop(home, "/app/update"); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(home, "desktop-launched")
	for attempt := 0; attempt < 40; attempt++ {
		if bytes, err := os.ReadFile(marker); err == nil {
			if string(bytes) != "http://127.0.0.1:8843/app/update" {
				t.Fatalf("desktop URL = %q", bytes)
			}
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("current desktop executable was not launched")
}
