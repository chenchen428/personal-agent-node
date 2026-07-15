package install

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct{ calls []string }

func (runner *fakeRunner) Run(_ context.Context, command string, args []string, _ []string) ([]byte, error) {
	runner.calls = append(runner.calls, command+" "+strings.Join(args, " "))
	return []byte(`{"platform":"darwin","serviceId":"site.personal-agent.private-site-node","filePath":"/tmp/source","installPath":"/tmp/target"}`), nil
}

type failingRunner struct {
	fakeRunner
	needle string
}

func (runner *failingRunner) Run(ctx context.Context, command string, args []string, env []string) ([]byte, error) {
	call := command + " " + strings.Join(args, " ")
	runner.calls = append(runner.calls, call)
	if strings.Contains(call, runner.needle) {
		return nil, errors.New("injected candidate failure")
	}
	return []byte(`{"platform":"darwin","serviceId":"site.personal-agent.private-site-node","filePath":"/tmp/source","installPath":"/tmp/target"}`), nil
}

func TestVerifyReleaseRejectsChangedFiles(t *testing.T) {
	release := fixtureRelease(t, "release-one")
	if _, err := VerifyRelease(release); err != nil {
		t.Fatalf("verify fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(release, "core/runtime/bin/personal-agent.mjs"), []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyRelease(release); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("expected checksum mismatch, got %v", err)
	}
}

func TestInstallSwitchesCurrentAndRetainsPreviousWithoutHostNode(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}

	first, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-one"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if first.ReleaseID != "release-one" || pointerTarget(filepath.Join(installRoot, "current")) == "" {
		t.Fatalf("unexpected first install: %#v", first)
	}
	second, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-two"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if second.ReleaseID != "release-two" {
		t.Fatalf("unexpected second install: %#v", second)
	}
	previous := pointerTarget(filepath.Join(installRoot, "previous"))
	if filepath.Base(previous) != "release-one" {
		t.Fatalf("previous=%s", previous)
	}
	if len(runner.calls) != 4 {
		t.Fatalf("expected init+prepare for each install, got %v", runner.calls)
	}
	if _, err := os.Stat(filepath.Join(pointerTarget(filepath.Join(installRoot, "current")), "runtime", "node")); err != nil {
		t.Fatal(err)
	}

	rolledBack, err := Rollback(context.Background(), installRoot, "darwin", runner)
	if err != nil {
		t.Fatal(err)
	}
	if rolledBack.ReleaseID != "release-one" {
		t.Fatalf("rollback=%#v", rolledBack)
	}
}

func TestFailedCandidateRestoresPointers(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-one"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, &fakeRunner{}); err != nil {
		t.Fatal(err)
	}
	runner := &failingRunner{needle: "release-two"}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-two"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner); err == nil {
		t.Fatal("expected candidate failure")
	}
	if got := filepath.Base(pointerTarget(filepath.Join(installRoot, "current"))); got != "release-one" {
		t.Fatalf("current=%s", got)
	}
	if got := pointerTarget(filepath.Join(installRoot, "previous")); got != "" {
		t.Fatalf("unexpected previous after failed candidate: %s", got)
	}
}

func TestWindowsPointersUseAtomicFilesWithoutShell(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node.exe")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-windows"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "windows"}, runner); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(installRoot, "current")
	if info, err := os.Lstat(current); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("Windows pointer must be a regular pointer file: %v", err)
	}
	if got := filepath.Base(pointerTarget(current)); got != "release-windows" {
		t.Fatalf("current=%s", got)
	}
	for _, call := range runner.calls {
		if strings.Contains(strings.ToLower(call), "cmd.exe") || strings.Contains(strings.ToLower(call), "mklink") {
			t.Fatalf("pointer unexpectedly used a shell: %s", call)
		}
	}
}

func TestUninstallRemovesProgramAndPreservesData(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	userFile := filepath.Join(dataRoot, "user-content.txt")
	if err := os.WriteFile(userFile, []byte("preserve me"), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(map[string]any{
		"schemaVersion":   2,
		"activeReleaseId": "release-one",
		"dataRoot":        dataRoot,
		"service":         "skipped",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installRoot, "releases", "release-one"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installRoot, "installation.json"), state, 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := Uninstall(context.Background(), installRoot, "darwin", &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	if !result.DataPreserved || result.DataRoot != dataRoot {
		t.Fatalf("unexpected uninstall result: %#v", result)
	}
	if _, err := os.Stat(installRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("install root still exists: %v", err)
	}
	if content, err := os.ReadFile(userFile); err != nil || string(content) != "preserve me" {
		t.Fatalf("user data was not preserved: %q %v", content, err)
	}
}

func TestUninstallRejectsUnsafeOrUnrecognizedRoots(t *testing.T) {
	if _, err := Uninstall(context.Background(), string(filepath.Separator), "darwin", &fakeRunner{}); err == nil {
		t.Fatal("expected filesystem root rejection")
	}
	if _, err := Uninstall(context.Background(), t.TempDir(), "darwin", &fakeRunner{}); err == nil || !strings.Contains(err.Error(), "installation.json") {
		t.Fatalf("expected installation marker rejection, got %v", err)
	}
}

func fixtureRelease(t *testing.T, releaseID string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), releaseID)
	files := map[string][]byte{
		"core/runtime/bin/personal-agent.mjs": []byte("// personal-agent"),
		"core/runtime/bin/private-site.mjs":   []byte("// private-site"),
		"SBOM.cdx.json":                       []byte(`{"bomFormat":"CycloneDX"}`),
	}
	manifest, _ := json.Marshal(map[string]any{"schemaVersion": 2, "releaseType": "personal-agent-node", "releaseId": releaseID, "revision": strings.Repeat("a", 40), "dirty": false})
	files["release-manifest.json"] = manifest
	for relative, content := range files {
		target := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	lines := make([]string, 0, len(files))
	for relative, content := range files {
		digest := sha256.Sum256(content)
		lines = append(lines, hex.EncodeToString(digest[:])+"  "+relative)
	}
	if err := os.WriteFile(filepath.Join(root, "SHA256SUMS"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}
