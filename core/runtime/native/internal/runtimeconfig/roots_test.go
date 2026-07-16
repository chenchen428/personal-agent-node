package runtimeconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRootsReadsDataRootFromInstallationState(t *testing.T) {
	installRoot := filepath.Join(t.TempDir(), "custom-program", "core")
	dataRoot := filepath.Join(t.TempDir(), "profile", ".personal-agent", "workspace")
	if err := os.MkdirAll(installRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installRoot, "installation.json"), []byte(`{"dataRoot":`+quoted(dataRoot)+`}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PERSONAL_AGENT_HOME", "")
	t.Setenv("PRIVATE_SITE_DATA_ROOT", "")
	roots, err := ResolveRoots(installRoot)
	if err != nil {
		t.Fatal(err)
	}
	if roots.DataRoot != dataRoot || roots.HomeRoot != filepath.Dir(dataRoot) {
		t.Fatalf("resolved roots %#v, want data %q and home %q", roots, dataRoot, filepath.Dir(dataRoot))
	}
}

func TestResolveRootsRejectsRelativeInstallationDataRoot(t *testing.T) {
	installRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(installRoot, "installation.json"), []byte(`{"dataRoot":"relative-workspace"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PERSONAL_AGENT_HOME", "")
	t.Setenv("PRIVATE_SITE_DATA_ROOT", "")
	if _, err := ResolveRoots(installRoot); err == nil {
		t.Fatal("expected relative dataRoot to be rejected")
	}
}

func quoted(value string) string {
	result := `"`
	for _, character := range value {
		if character == '\\' || character == '"' {
			result += `\`
		}
		result += string(character)
	}
	return result + `"`
}
