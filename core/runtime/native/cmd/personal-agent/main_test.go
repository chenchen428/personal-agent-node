package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstalledDataRootUsesInstallationState(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "core")
	customDataRoot := filepath.Join(root, "customer-workspace")
	if err := os.MkdirAll(installRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	state := []byte(`{"schemaVersion":2,"dataRoot":"` + filepath.ToSlash(customDataRoot) + `"}`)
	if err := os.WriteFile(filepath.Join(installRoot, "installation.json"), state, 0o600); err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.Abs(customDataRoot)
	if err != nil {
		t.Fatal(err)
	}
	if actual := installedDataRoot(installRoot); actual != resolved {
		t.Fatalf("installed data root = %q, want %q", actual, resolved)
	}
}

func TestInstalledDataRootFallsBackBesideCore(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "core")
	if actual, expected := installedDataRoot(installRoot), filepath.Join(root, "workspace"); actual != expected {
		t.Fatalf("fallback data root = %q, want %q", actual, expected)
	}
}
