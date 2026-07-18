package main

import (
	"path/filepath"
	"testing"
)

func TestWindowsInteractiveInstallUsesSelectedHome(t *testing.T) {
	selected := filepath.Join(t.TempDir(), "Personal Agent")
	home, accepted, err := resolveInstallHome(filepath.Join(t.TempDir(), ".personal-agent"), true, "windows", func(defaultPath string) (string, bool, error) {
		if !filepath.IsAbs(defaultPath) {
			t.Fatalf("default path is not absolute: %s", defaultPath)
		}
		return selected, true, nil
	})
	if err != nil || !accepted || home != filepath.Clean(selected) {
		t.Fatalf("resolved home = %q, accepted = %v, error = %v", home, accepted, err)
	}
	if filepath.Join(home, "core") == filepath.Join(home, "workspace") {
		t.Fatal("immutable core and mutable workspace must remain separate")
	}
}

func TestWindowsInteractiveInstallCanBeCancelled(t *testing.T) {
	_, accepted, err := resolveInstallHome(t.TempDir(), true, "windows", func(string) (string, bool, error) {
		return "", false, nil
	})
	if err != nil || accepted {
		t.Fatalf("accepted = %v, error = %v", accepted, err)
	}
}

func TestExplicitAndNonWindowsInstallsDoNotOpenPicker(t *testing.T) {
	for _, test := range []struct {
		name        string
		interactive bool
		platform    string
	}{
		{name: "explicit Windows command", interactive: false, platform: "windows"},
		{name: "macOS double click", interactive: true, platform: "darwin"},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			defaultHome := t.TempDir()
			home, accepted, err := resolveInstallHome(defaultHome, test.interactive, test.platform, func(string) (string, bool, error) {
				called = true
				return "", false, nil
			})
			if err != nil || !accepted || called || home != filepath.Clean(defaultHome) {
				t.Fatalf("home = %q, accepted = %v, called = %v, error = %v", home, accepted, called, err)
			}
		})
	}
}
